import chalk from 'chalk';

const logLevel = process.env.LOG_LEVEL || 'info';
const shouldColorize = process.env.COLORIZE !== '0';

const levels = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const levelColors: Record<keyof typeof levels, (str: string) => string> = {
  trace: chalk.gray,
  debug: chalk.cyan,
  info: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  fatal: chalk.bgRed.white,
};

const currentLevel = levels[logLevel as keyof typeof levels] ?? levels.info;

function createLogger(context?: Record<string, unknown>) {
  const log = (
    level: keyof typeof levels,
    msgOrObj: string | Record<string, unknown>,
    ...args: unknown[]
  ) => {
    if (levels[level] < currentLevel) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const timestamp = `${hours}:${minutes}:${seconds}.${ms}`;

    let message: string;
    let extraContext: Record<string, unknown> = {};

    if (typeof msgOrObj === 'string') {
      message = msgOrObj;
    } else {
      extraContext = msgOrObj;
      message = args[0] as string;
      args = args.slice(1);
    }

    const allContext = { ...context, ...extraContext };
    const contextStr =
      Object.keys(allContext).length > 0
        ? ` | ${Object.entries(allContext)
            .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
            .join(' ')}`
        : '';
    const method =
      level === 'fatal' || level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';

    const levelStr = level.toUpperCase().padEnd(5);
    const colorize = shouldColorize ? levelColors[level] : (s: string) => s;
    const timestampColored = shouldColorize ? chalk.gray(timestamp) : timestamp;
    const levelColored = colorize(levelStr);

    console[method](`${timestampColored} | ${levelColored}${contextStr} | ${message}`, ...args);
  };

  return {
    trace: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('trace', msgOrObj, ...args),
    debug: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('debug', msgOrObj, ...args),
    info: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('info', msgOrObj, ...args),
    warn: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('warn', msgOrObj, ...args),
    error: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('error', msgOrObj, ...args),
    fatal: (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) =>
      log('fatal', msgOrObj, ...args),
    child: (childContext: Record<string, unknown>) => createLogger({ ...context, ...childContext }),
  };
}

export const logger = createLogger();
export const tcpClientLogger = logger.child({ component: 'tcp-client' });
