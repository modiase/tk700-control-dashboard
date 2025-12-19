import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { pipe } from 'fp-ts/function';
import { TCPClient } from './lib/tcp/client';
import * as RT from './lib/resultTask';
import { logger } from './lib/logger';
import { StateRegistry, type State } from './lib/stateRegistry';
import { PowerController, type PowerStateData } from './lib/controllers/powerController';
import { VolumeController } from './lib/controllers/volumeController';
import { KeystoneController, type KeystoneValue } from './lib/controllers/keystoneController';
import { BlankController } from './lib/controllers/blankController';
import { FreezeController } from './lib/controllers/freezeController';
import { TemperatureController } from './lib/controllers/temperatureController';
import { FanController } from './lib/controllers/fanController';
import {
  PictureSettingsController,
  type PictureSettingsValue,
} from './lib/controllers/pictureSettingsController';
import { PictureModeController } from './lib/controllers/pictureModeController';
import { HdmiSourceController } from './lib/controllers/hdmiSourceController';
import { MenuController } from './lib/controllers/menuController';

const app = new Hono();

app.use('/*', cors());

if (!process.env.TK700_CONTROLLER_HOST || !process.env.TK700_CONTROLLER_PORT) {
  throw new Error(
    'TK700_CONTROLLER_HOST and TK700_CONTROLLER_PORT environment variables are required'
  );
}

const tcpClient = new TCPClient(
  process.env.TK700_CONTROLLER_HOST,
  parseInt(process.env.TK700_CONTROLLER_PORT),
  parseInt(process.env.TK700_CONTROLLER_TIMEOUT || '5000')
);

const stateRegistry = new StateRegistry();

const powerController = new PowerController(tcpClient, stateRegistry);
const volumeController = new VolumeController(tcpClient, stateRegistry);
const keystoneController = new KeystoneController(tcpClient, stateRegistry);
const blankController = new BlankController(tcpClient, stateRegistry);
const freezeController = new FreezeController(tcpClient, stateRegistry);
const temperatureController = new TemperatureController(tcpClient, stateRegistry);
const fanController = new FanController(tcpClient, stateRegistry);
const pictureSettingsController = new PictureSettingsController(tcpClient, stateRegistry);
const pictureModeController = new PictureModeController(tcpClient, stateRegistry);
const hdmiSourceController = new HdmiSourceController(tcpClient, stateRegistry);
const menuController = new MenuController(tcpClient);

interface SSEData {
  powerState: PowerStateData;
  temperature: State<number | null>;
  fanSpeed: State<number | null>;
  volume: State<number | null>;
  pictureMode: State<string | null>;
  pictureSettings: State<PictureSettingsValue | null>;
  hdmiSource: State<string | null>;
  blank: State<boolean | null>;
  freeze: State<boolean | null>;
  keystone: State<KeystoneValue | null>;
}

class SSEBroadcaster {
  private clients = new Set<any>();
  private pollInterval: Timer | null = null;
  private readonly POLL_INTERVAL_MS = 2000;

  addClient(stream: any) {
    this.clients.add(stream);
    logger.info({ clientCount: this.clients.size }, 'SSE client connected');
    if (!this.pollInterval) {
      this.startPolling();
    }
  }

  removeClient(stream: any) {
    this.clients.delete(stream);
    logger.info({ clientCount: this.clients.size }, 'SSE client disconnected');
    if (this.clients.size === 0) {
      this.stopPolling();
    }
  }

  private startPolling() {
    logger.info('Starting server-side polling for SSE');
    this.pollInterval = setInterval(async () => {
      const data = await this.fetchAllData();
      await this.broadcast(data);
    }, this.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollInterval) {
      logger.info('Stopping server-side polling (no SSE clients)');
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async fetchAllData(): Promise<SSEData> {
    await powerController.fetchState();
    const powerState = stateRegistry.getState<PowerStateData>('powerState').value;

    if (!(powerState.powerOn === true && powerState.state === 'ON')) {
      return {
        powerState,
        temperature: { value: null, mutable: false },
        fanSpeed: { value: null, mutable: false },
        volume: { value: null, mutable: false },
        pictureMode: { value: null, mutable: false },
        pictureSettings: {
          value: {
            brightness: null,
            contrast: null,
            sharpness: null,
          },
          mutable: false,
        },
        hdmiSource: { value: null, mutable: false },
        blank: { value: null, mutable: false },
        freeze: { value: null, mutable: false },
        keystone: {
          value: {
            horizontal: null,
            vertical: null,
          },
          mutable: false,
        },
      };
    }

    await Promise.all([
      temperatureController.fetchState(),
      fanController.fetchState(),
      volumeController.fetchState(),
      pictureModeController.fetchState(),
      pictureSettingsController.fetchState(),
      hdmiSourceController.fetchState(),
      blankController.fetchState(),
      freezeController.fetchState(),
      keystoneController.fetchState(),
    ]);

    return {
      powerState,
      temperature: stateRegistry.getState('temperature'),
      fanSpeed: stateRegistry.getState('fanSpeed'),
      volume: stateRegistry.getState('volume'),
      pictureMode: stateRegistry.getState('pictureMode'),
      pictureSettings: stateRegistry.getState('pictureSettings'),
      hdmiSource: stateRegistry.getState('hdmiSource'),
      blank: stateRegistry.getState('blank'),
      freeze: stateRegistry.getState('freeze'),
      keystone: stateRegistry.getState('keystone'),
    };
  }

  private async broadcast(data: SSEData) {
    const clientsBefore = this.clients.size;
    await Promise.all(
      Array.from(this.clients).map(async stream => {
        try {
          await stream.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'SSE client write failed'
          );
          this.clients.delete(stream);
        }
      })
    );
    if (this.clients.size < clientsBefore) {
      logger.info(
        {
          clientsBefore,
          clientsAfter: this.clients.size,
          removed: clientsBefore - this.clients.size,
        },
        'Cleaned up failed SSE clients'
      );
    }
  }

  async broadcastCurrentState() {
    await this.broadcast({
      powerState: stateRegistry.getState<PowerStateData>('powerState').value,
      temperature: stateRegistry.getState('temperature'),
      fanSpeed: stateRegistry.getState('fanSpeed'),
      volume: stateRegistry.getState('volume'),
      pictureMode: stateRegistry.getState('pictureMode'),
      pictureSettings: stateRegistry.getState('pictureSettings'),
      hdmiSource: stateRegistry.getState('hdmiSource'),
      blank: stateRegistry.getState('blank'),
      freeze: stateRegistry.getState('freeze'),
      keystone: stateRegistry.getState('keystone'),
    });
  }
}

const sseBroadcaster = new SSEBroadcaster();

const handleTask = async <T>(task: RT.ResultTask<T>, c: Context) =>
  pipe(await task(), RT.toApiResponse, response => c.json(response, response.error ? 500 : 200));

const handleMutation = async (stateKey: string, operation: () => Promise<void>, c: Context) => {
  const state = stateRegistry.getState(stateKey);
  if (!state.mutable) {
    return c.json({ error: 'Request already in progress', data: null }, 429);
  }

  try {
    const operationPromise = operation();
    await sseBroadcaster.broadcastCurrentState();
    await operationPromise;
    await sseBroadcaster.broadcastCurrentState();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
};

app.get('/api/stream', c => {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return c.stream(async stream => {
    sseBroadcaster.addClient(stream);

    await stream.write(`data: ${JSON.stringify(await sseBroadcaster.fetchAllData())}\n\n`);

    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
      sseBroadcaster.removeClient(stream);
    });

    while (!aborted) {
      await stream.sleep(15000);
      if (!aborted) {
        try {
          await stream.write(': keepalive\n');
        } catch (error) {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'SSE keepalive write failed'
          );
          break;
        }
      }
    }
  });
});

app.get('/api/power-state', async c => {
  await powerController.fetchState();
  const powerState = stateRegistry.getState<PowerStateData>('powerState').value;
  return c.json({ error: null, data: powerState });
});

app.get('/api/power', async c => handleTask(tcpClient.getPowerStatus(), c));

app.post('/api/power', async c => {
  const { on } = await c.req.json();
  return handleMutation('powerState', () => powerController.setPower(on), c);
});

app.get('/api/temperature', async c => handleTask(tcpClient.getTemperature(), c));

app.get('/api/fan', async c => handleTask(tcpClient.getFanSpeed(), c));

app.get('/api/volume', async c => handleTask(tcpClient.getVolume(), c));

app.post('/api/volume', async c => {
  const { level } = await c.req.json();
  return handleMutation('volume', () => volumeController.setVolume(level), c);
});

app.get('/api/picture-mode', async c => handleTask(tcpClient.getPictureMode(), c));

app.post('/api/picture-mode', async c => {
  const { mode } = await c.req.json();
  return handleMutation('pictureMode', () => pictureModeController.setPictureMode(mode), c);
});

app.get('/api/brightness', async c => handleTask(tcpClient.getBrightness(), c));

app.post('/api/brightness', async c => {
  const body = await c.req.json();

  if (body.direction) {
    return handleMutation(
      'pictureSettings',
      () => pictureSettingsController.adjustBrightness(body.direction),
      c
    );
  } else if (body.value !== undefined) {
    return handleMutation(
      'pictureSettings',
      () => pictureSettingsController.setBrightness(body.value),
      c
    );
  } else {
    return c.json({ error: 'Invalid request', data: null }, 400);
  }
});

app.get('/api/contrast', async c => handleTask(tcpClient.getContrast(), c));

app.post('/api/contrast', async c => {
  const { value } = await c.req.json();
  return handleMutation('pictureSettings', () => pictureSettingsController.setContrast(value), c);
});

app.get('/api/sharpness', async c => handleTask(tcpClient.getSharpness(), c));

app.post('/api/sharpness', async c => {
  const { value } = await c.req.json();
  return handleMutation('pictureSettings', () => pictureSettingsController.setSharpness(value), c);
});

app.get('/api/hdmi-source', async c => handleTask(tcpClient.getHdmiSource(), c));

app.post('/api/hdmi-source', async c => {
  const { source } = await c.req.json();
  return handleMutation('hdmiSource', () => hdmiSourceController.setHdmiSource(source), c);
});

app.get('/api/blank', async c => handleTask(tcpClient.getBlankStatus(), c));

app.post('/api/blank', async c => {
  const { on } = await c.req.json();
  return handleMutation('blank', () => blankController.setBlank(on), c);
});

app.get('/api/freeze', async c => handleTask(tcpClient.getFreezeStatus(), c));

app.post('/api/freeze', async c => {
  const { on } = await c.req.json();
  return handleMutation('freeze', () => freezeController.setFreeze(on), c);
});

app.post('/api/keystone/vertical', async c => {
  const { direction } = await c.req.json();
  return handleMutation('keystone', () => keystoneController.adjustVertical(direction), c);
});

app.post('/api/keystone/horizontal', async c => {
  const { direction } = await c.req.json();
  return handleMutation('keystone', () => keystoneController.adjustHorizontal(direction), c);
});

app.post('/api/menu/open', async c => {
  try {
    await menuController.openMenu();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/close', async c => {
  try {
    await menuController.closeMenu();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/up', async c => {
  try {
    await menuController.navigateUp();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/down', async c => {
  try {
    await menuController.navigateDown();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/right', async c => {
  try {
    await menuController.navigateRight();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/left', async c => {
  try {
    await menuController.navigateLeft();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/enter', async c => {
  try {
    await menuController.confirm();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.post('/api/menu/back', async c => {
  try {
    await menuController.back();
    return c.json({ error: null, data: null });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error), data: null },
      500
    );
  }
});

app.use('/*', serveStatic({ root: './dist' }));
app.use('/*', serveStatic({ path: './dist/index.html' }));

if (!process.env.PORT) {
  throw new Error('PORT environment variable is required');
}

const port = parseInt(process.env.PORT);
const hostname = process.env.HOST;

const logConfig: any = { port, tk700Host: process.env.TK700_CONTROLLER_HOST };
if (hostname) {
  logConfig.hostname = hostname;
}
logger.info(logConfig, 'TK700_CONTROLLER Control Server starting');

const serverConfig: any = { port, fetch: app.fetch };
if (hostname) {
  serverConfig.hostname = hostname;
}

export default serverConfig;
