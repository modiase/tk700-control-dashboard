import { interval, EMPTY, Observable, of } from 'rxjs';
import { switchMap, distinctUntilChanged, shareReplay, startWith, map } from 'rxjs/operators';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import {
  getPowerState,
  type PowerStateData,
  getTemperature,
  getFanSpeed,
  getVolume,
  getPictureMode,
  getBrightness,
  getContrast,
  getSharpness,
} from './api';

const POLL_INTERVAL = 2000;

const fetchPowerState = (): TE.TaskEither<Error, PowerStateData> =>
  TE.tryCatch(
    () => getPowerState(),
    e => new Error(`Failed to fetch power state: ${e}`)
  );

const power$ = interval(POLL_INTERVAL).pipe(
  startWith(0),
  switchMap(() => fetchPowerState()()),
  map(either => (E.isRight(either) ? either.right : null)),
  shareReplay(1)
);

export const powerState = power$;

const isProjectorOn$ = power$.pipe(
  map(state => state !== null && state.powerOn === true && state.state === 'ON'),
  distinctUntilChanged(),
  shareReplay(1)
);

const createPollingTask = <T>(
  fetchFn: () => Promise<T>,
  errorMsg: string
): TE.TaskEither<Error, T | null> =>
  pipe(
    TE.tryCatch(fetchFn, e => new Error(`${errorMsg}: ${e}`)),
    TE.orElse((): TE.TaskEither<Error, T | null> => TE.of(null))
  );

const createConditionalPoller$ = <T>(
  condition$: Observable<boolean>,
  task: TE.TaskEither<Error, T | null>
): Observable<T | null> =>
  condition$.pipe(
    switchMap(isOn =>
      isOn
        ? interval(POLL_INTERVAL).pipe(
            startWith(0),
            switchMap(() => task().then(E.getOrElse((): T | null => null)))
          )
        : of(null)
    ),
    shareReplay(1)
  );

export const temperature$ = createConditionalPoller$(
  isProjectorOn$,
  createPollingTask(getTemperature, 'Failed to fetch temperature')
);

export const fanSpeed$ = createConditionalPoller$(
  isProjectorOn$,
  createPollingTask(getFanSpeed, 'Failed to fetch fan speed')
);

export const volume$ = createConditionalPoller$(
  isProjectorOn$,
  createPollingTask(getVolume, 'Failed to fetch volume')
);

export const pictureMode$ = createConditionalPoller$(
  isProjectorOn$,
  createPollingTask(getPictureMode, 'Failed to fetch picture mode')
);

interface PictureSettings {
  brightness: number | null;
  contrast: number | null;
  sharpness: number | null;
}

const fetchPictureSettings: TE.TaskEither<Error, PictureSettings> = pipe(
  TE.tryCatch(
    () => Promise.all([getBrightness(), getContrast(), getSharpness()]),
    e => new Error(`Failed to fetch picture settings: ${e}`)
  ),
  TE.map(
    ([brightness, contrast, sharpness]): PictureSettings => ({ brightness, contrast, sharpness })
  ),
  TE.orElse(
    (): TE.TaskEither<Error, PictureSettings> =>
      TE.of({ brightness: null, contrast: null, sharpness: null })
  )
);

export const pictureSettings$ = createConditionalPoller$(isProjectorOn$, fetchPictureSettings);
