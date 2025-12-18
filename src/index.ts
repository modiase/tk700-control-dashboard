import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { pipe } from 'fp-ts/function';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import * as IO from 'fp-ts/IO';
import { TK700Client } from './lib/tk700-client';
import * as AT from './lib/apiTask';
import { logger } from './lib/logger';

enum PowerState {
  OFF = 'OFF',
  WARMING_UP = 'WARMING_UP',
  ON = 'ON',
  COOLING_DOWN = 'COOLING_DOWN',
  UNKNOWN = 'UNKNOWN',
}

interface PowerStateData {
  powerOn: boolean | null;
  state: PowerState;
  transitionStartTime: number | null;
}

interface PowerStateInfo extends PowerStateData {
  remainingSeconds: number;
}

const WARMING_UP_TIME_SECONDS = 30;
const COOLING_DOWN_TIME_SECONDS = 90;

const initialState: PowerStateData = {
  powerOn: null,
  state: PowerState.UNKNOWN,
  transitionStartTime: null,
};

const calculateTimeSinceTransition = (startTime: number | null): number =>
  startTime ? (Date.now() - startTime) / 1000 : Infinity;

const inferPowerState =
  (current: PowerStateData) =>
  (powerOn: boolean): PowerState => {
    const timeSinceTransition = calculateTimeSinceTransition(current.transitionStartTime);

    if (current.state === PowerState.WARMING_UP && timeSinceTransition < WARMING_UP_TIME_SECONDS) {
      return PowerState.WARMING_UP;
    }

    if (
      current.state === PowerState.COOLING_DOWN &&
      timeSinceTransition < COOLING_DOWN_TIME_SECONDS
    ) {
      return PowerState.COOLING_DOWN;
    }

    return powerOn ? PowerState.ON : PowerState.OFF;
  };

const shouldResetTransition = (currentState: PowerState, newState: PowerState): boolean =>
  newState !== currentState && (newState === PowerState.ON || newState === PowerState.OFF);

const updateFromProjector =
  (current: PowerStateData) =>
  (powerOn: boolean | null): PowerStateData =>
    pipe(
      O.fromNullable(powerOn),
      O.map(on => {
        const newState = inferPowerState(current)(on);
        return {
          powerOn: on,
          state: newState,
          transitionStartTime: shouldResetTransition(current.state, newState)
            ? null
            : current.transitionStartTime,
        };
      }),
      O.getOrElse(() => current)
    );

const initiateTransition =
  (current: PowerStateData) =>
  (targetOn: boolean): PowerStateData => {
    const canTurnOn = current.state === PowerState.OFF;
    const canTurnOff = current.state === PowerState.ON;

    if (targetOn && canTurnOn) {
      return {
        powerOn: targetOn,
        state: PowerState.WARMING_UP,
        transitionStartTime: Date.now(),
      };
    }

    if (!targetOn && canTurnOff) {
      return {
        powerOn: targetOn,
        state: PowerState.COOLING_DOWN,
        transitionStartTime: Date.now(),
      };
    }

    return current;
  };

const calculateRemainingSeconds = (state: PowerStateData): number => {
  if (state.transitionStartTime === null) return 0;

  const timeSinceTransition = calculateTimeSinceTransition(state.transitionStartTime);
  const totalTime =
    state.state === PowerState.WARMING_UP ? WARMING_UP_TIME_SECONDS : COOLING_DOWN_TIME_SECONDS;

  return Math.max(0, Math.ceil(totalTime - timeSinceTransition));
};

const enrichWithRemainingSeconds = (state: PowerStateData): PowerStateInfo => ({
  ...state,
  remainingSeconds: calculateRemainingSeconds(state),
});

const makePowerStateManager = () => {
  let state = initialState;

  const getState: IO.IO<PowerStateData> = () => state;

  const getStateInfo: IO.IO<PowerStateInfo> = pipe(getState, IO.map(enrichWithRemainingSeconds));

  const modifyState =
    (f: (current: PowerStateData) => PowerStateData): IO.IO<PowerStateData> =>
    () => {
      state = f(state);
      return state;
    };

  const updateFromProjectorStatus = (powerOn: boolean | null): IO.IO<PowerStateData> =>
    modifyState(current => updateFromProjector(current)(powerOn));

  const initiateTransitionTo = (targetOn: boolean): IO.IO<PowerStateData> =>
    modifyState(current => initiateTransition(current)(targetOn));

  return {
    getState,
    getStateInfo,
    updateFromProjectorStatus,
    initiateTransitionTo,
  };
};

const app = new Hono();

app.use('/*', cors());

if (!process.env.TK700_HOST || !process.env.TK700_PORT) {
  throw new Error('TK700_HOST and TK700_PORT environment variables are required');
}

const tk700Client = new TK700Client(
  process.env.TK700_HOST,
  parseInt(process.env.TK700_PORT),
  parseInt(process.env.TK700_TIMEOUT || '5000')
);

const powerStateManager = makePowerStateManager();

const handleTask = async <T>(task: AT.ApiTask<T>, c: Context) =>
  pipe(await task(), AT.toApiResponse, response => c.json(response, response.error ? 500 : 200));

app.get('/api/power-state', async c => {
  const powerStatus = await tk700Client.getPowerStatus()();
  pipe(
    powerStatus,
    E.map(O.toNullable),
    E.getOrElse((): boolean | null => null),
    powerOn => powerStateManager.updateFromProjectorStatus(powerOn)()
  );
  return c.json({ error: null, data: powerStateManager.getStateInfo() });
});

app.get('/api/power', async c => handleTask(tk700Client.getPowerStatus(), c));

app.post('/api/power', async c => {
  const { on } = await c.req.json();
  powerStateManager.initiateTransitionTo(on)();
  return handleTask(tk700Client.setPower(on), c);
});

app.get('/api/temperature', async c => handleTask(tk700Client.getTemperature(), c));

app.get('/api/fan', async c => handleTask(tk700Client.getFanSpeed(), c));

app.get('/api/volume', async c => handleTask(tk700Client.getVolume(), c));

app.post('/api/volume', async c => {
  const { level } = await c.req.json();
  return handleTask(tk700Client.setVolume(level), c);
});

app.get('/api/picture-mode', async c => handleTask(tk700Client.getPictureMode(), c));

app.post('/api/picture-mode', async c => {
  const { mode } = await c.req.json();
  return handleTask(tk700Client.setPictureMode(mode), c);
});

app.get('/api/brightness', async c => handleTask(tk700Client.getBrightness(), c));

app.post('/api/brightness', async c => {
  const body = await c.req.json();

  if (body.direction) {
    return handleTask(tk700Client.adjustBrightness(body.direction), c);
  } else if (body.value !== undefined) {
    return handleTask(tk700Client.setBrightness(body.value), c);
  }

  return c.json({ error: 'Invalid request', data: null }, 400);
});

app.get('/api/contrast', async c => handleTask(tk700Client.getContrast(), c));

app.post('/api/contrast', async c => {
  const { value } = await c.req.json();
  return handleTask(tk700Client.setContrast(value), c);
});

app.get('/api/sharpness', async c => handleTask(tk700Client.getSharpness(), c));

app.post('/api/sharpness', async c => {
  const { value } = await c.req.json();
  return handleTask(tk700Client.setSharpness(value), c);
});

app.use('/*', serveStatic({ root: './dist' }));
app.use('/*', serveStatic({ path: './dist/index.html' }));

if (!process.env.PORT) {
  throw new Error('PORT environment variable is required');
}

const port = parseInt(process.env.PORT);
const hostname = process.env.HOST;

const logConfig: any = { port, tk700Host: process.env.TK700_HOST };
if (hostname) {
  logConfig.hostname = hostname;
}
logger.info(logConfig, 'TK700 Control Server starting');

const serverConfig: any = { port, fetch: app.fetch };
if (hostname) {
  serverConfig.hostname = hostname;
}

export default serverConfig;
