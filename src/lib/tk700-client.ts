import { connect } from 'net';
import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import { pipe, flow } from 'fp-ts/function';
import * as AT from './apiTask';
import { tk700Logger as logger } from './logger';

const tap =
  <T>(fn: (value: T) => void) =>
  (value: T): T => (fn(value), value);

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  consecutiveErrors: number;
}

export class TK700Client {
  private host: string;
  private port: number;
  private timeout: number;
  private commandQueue: Promise<any> = Promise.resolve();
  private cache = new Map<string, CacheEntry<any>>();
  private inFlightRequests = new Map<string, Promise<any>>();
  private cacheMaxAge = 1000;
  private maxConsecutiveErrors = 3;

  constructor(host: string, port: number, timeout: number) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
  }

  private sendCommand = (command: string): TE.TaskEither<Error, string> =>
    TE.tryCatch(
      async () => {
        const task = this.commandQueue.then(
          () => this.executeCommand(command),
          () => this.executeCommand(command)
        );
        this.commandQueue = task.catch(() => {});
        return task;
      },
      error => (error instanceof Error ? error : new Error(String(error)))
    );

  private async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const formattedCommand = `\r*${command}#\r`;
      const client = connect(this.port, this.host);

      let responseData = '';
      let dataReceived = false;
      const timeoutId = setTimeout(() => {
        client.destroy();
        reject(new Error('Connection timeout'));
      }, this.timeout);

      client.on('connect', () => {
        client.write(formattedCommand);
      });

      client.on('data', (data: Buffer) => {
        responseData += data.toString();
        dataReceived = true;

        setTimeout(() => {
          if (dataReceived) {
            clearTimeout(timeoutId);
            client.end();
          }
        }, 100);
      });

      client.on('end', () => {
        const responses = responseData.split('\r').filter(r => r.trim());
        const actualResponse =
          responses
            .filter(r => !r.startsWith('>'))
            .filter(r => r !== '*Block item#')
            .find(r => r.match(/^\*[A-Z0-9 ]+=?.*#$/)) || responseData;
        resolve(actualResponse.trim());
      });

      client.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private checkBlockItem = (response: string): O.Option<string> =>
    response.includes('Block item') ? O.none : O.some(response);

  private parseResponse =
    (regex: RegExp, transform: (match: string) => any = s => s) =>
    (response: string): O.Option<any> =>
      pipe(
        O.fromNullable(response.match(regex)),
        O.chain(match => (match[1] ? O.some(transform(match[1])) : O.none))
      );

  private optionToTask =
    <T>(logMsg: string) =>
    (option: O.Option<T>): AT.ApiTask<T> =>
      pipe(
        option,
        O.fold(
          () => (logger.debug(logMsg), AT.none()),
          value => (logger.debug({ value }, logMsg), AT.of(value))
        )
      );

  private isStale = (entry: CacheEntry<any>): boolean =>
    Date.now() - entry.timestamp > this.cacheMaxAge;

  private shouldInvalidate = (entry: CacheEntry<any>): boolean =>
    entry.consecutiveErrors >= this.maxConsecutiveErrors;

  private getCached = <T>(key: string): O.Option<T> =>
    pipe(
      O.fromNullable(this.cache.get(key)),
      O.filter(entry => !this.shouldInvalidate(entry)),
      O.map(entry => entry.value)
    );

  private setCached = <T>(key: string, value: T): void => {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      consecutiveErrors: 0,
    });
  };

  private recordError = (key: string): void => {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.set(key, {
        ...entry,
        consecutiveErrors: entry.consecutiveErrors + 1,
      });
    }
  };

  private updateFromFetch = <T>(key: string, result: E.Either<Error, O.Option<T>>): O.Option<T> =>
    pipe(
      result,
      E.fold(
        () => {
          this.recordError(key);
          return this.getCached<T>(key);
        },
        option =>
          pipe(
            option,
            O.fold(
              () => {
                this.recordError(key);
                return this.getCached<T>(key);
              },
              value => {
                const entry = this.cache.get(key);
                if (entry) {
                  this.cache.set(key, {
                    value,
                    timestamp: Date.now(),
                    consecutiveErrors: 0,
                  });
                } else {
                  this.setCached(key, value);
                }
                return O.some(value);
              }
            )
          )
      )
    );

  private queryPipeline = <T>(
    command: string,
    regex: RegExp,
    transform: (match: string) => T = s => s as unknown as T,
    logContext: string = command
  ): AT.ApiTask<T> => async () => {
    const cacheKey = command;
    const cached = this.getCached<T>(cacheKey);

    return pipe(
      cached,
      O.fold(
        async () => {
          const existingRequest = this.inFlightRequests.get(cacheKey);
          if (existingRequest) {
            return existingRequest;
          }

          const request = pipe(
            this.sendCommand(command),
            TE.map(tap(response => logger.debug({ response }, `${logContext} raw response`))),
            TE.map(this.checkBlockItem),
            TE.chain(
              flow(
                O.chain(this.parseResponse(regex, transform)),
                this.optionToTask(`Parsed ${logContext}`)
              )
            ),
            AT.tapError(error => logger.error({ error, command }, `Failed to get ${logContext}`))
          )();

          this.inFlightRequests.set(cacheKey, request);

          try {
            const result = await request;
            this.inFlightRequests.delete(cacheKey);
            return E.right(this.updateFromFetch(cacheKey, result));
          } catch (error) {
            this.inFlightRequests.delete(cacheKey);
            throw error;
          }
        },
        async value => {
          const entry = this.cache.get(cacheKey);
          if (entry && this.isStale(entry)) {
            pipe(
              this.sendCommand(command),
              TE.map(tap(response => logger.debug({ response }, `${logContext} raw response`))),
              TE.map(this.checkBlockItem),
              TE.chain(
                flow(
                  O.chain(this.parseResponse(regex, transform)),
                  this.optionToTask(`Parsed ${logContext}`)
                )
              ),
              AT.tapError(error => logger.error({ error, command }, `Failed to get ${logContext}`))
            )()
              .then(result => this.updateFromFetch(cacheKey, result))
              .catch(() => this.recordError(cacheKey));
          }
          return E.right(O.some(value));
        }
      )
    );
  };

  private commandPipeline = (
    command: string,
    logInfo: any,
    logContext: string
  ): AT.ApiTask<undefined> =>
    pipe(
      this.sendCommand(command),
      TE.map(() => (logger.info(logInfo, `${logContext} command sent`), O.some(undefined))),
      AT.tapError(error => logger.error({ error, ...logInfo }, `Failed to ${logContext}`))
    );

  getPowerStatus = (): AT.ApiTask<boolean> =>
    this.queryPipeline(
      'pow=?',
      /POW=(ON|OFF)/i,
      match => match.toUpperCase() === 'ON',
      'power status'
    );

  setPower = (on: boolean): AT.ApiTask<undefined> =>
    this.commandPipeline(on ? 'pow=on' : 'pow=off', { on }, 'set power');

  getTemperature = (): AT.ApiTask<number> =>
    this.queryPipeline('tmp1=?', /TMP1=(\d+)/i, match => parseInt(match) / 10, 'temperature');

  getFanSpeed = (): AT.ApiTask<number> =>
    this.queryPipeline('fan1=?', /FAN\w*=(\d+)/i, parseInt, 'fan speed');

  getVolume = (): AT.ApiTask<number> =>
    this.queryPipeline('vol=?', /VOL=(\d+)/i, parseInt, 'volume');

  setVolume = (level: number): AT.ApiTask<undefined> =>
    this.commandPipeline(`vol=${Math.max(0, Math.min(20, level))}`, { level }, 'set volume');

  getPictureMode = (): AT.ApiTask<string> =>
    this.queryPipeline(
      'appmod=?',
      /APPMOD=([A-Z0-9]+)/i,
      match => match.toLowerCase(),
      'picture mode'
    );

  setPictureMode = (mode: string): AT.ApiTask<undefined> =>
    this.commandPipeline(`appmod=${mode}`, { mode }, 'set picture mode');

  getBrightness = (): AT.ApiTask<number> =>
    this.queryPipeline('bri=?', /BRI=(\d+)/i, parseInt, 'brightness');

  adjustBrightness = (direction: 'up' | 'down'): AT.ApiTask<undefined> =>
    this.commandPipeline(
      direction === 'up' ? 'bri=+' : 'bri=-',
      { direction },
      'adjust brightness'
    );

  setBrightness = (value: number): AT.ApiTask<undefined> =>
    this.commandPipeline(`bri=${value}`, { value }, 'set brightness');

  getContrast = (): AT.ApiTask<number> =>
    this.queryPipeline('con=?', /CON=(\d+)/i, parseInt, 'contrast');

  setContrast = (value: number): AT.ApiTask<undefined> =>
    this.commandPipeline(`con=${value}`, { value }, 'set contrast');

  getSharpness = (): AT.ApiTask<number> =>
    this.queryPipeline('sharp=?', /SHARP=(\d+)/i, parseInt, 'sharpness');

  setSharpness = (value: number): AT.ApiTask<undefined> =>
    this.commandPipeline(`sharp=${value}`, { value }, 'set sharpness');
}
