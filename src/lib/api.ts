const BASE_PATH = import.meta.env.BASE_URL || '/';
const API_BASE = `${BASE_PATH}${BASE_PATH.endsWith('/') ? '' : '/'}api`;

export interface PowerStateData {
  powerOn: boolean | null;
  state: 'OFF' | 'WARMING_UP' | 'ON' | 'COOLING_DOWN' | 'UNKNOWN';
  transitionStartTime: number | null;
  remainingSeconds: number;
}

export async function getPowerState(): Promise<PowerStateData> {
  const res = await fetch(`${API_BASE}/power-state`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function getPowerStatus(): Promise<boolean | null> {
  const res = await fetch(`${API_BASE}/power`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function setPower(on: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function getTemperature(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/temperature`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function getFanSpeed(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/fan`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function getVolume(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/volume`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function setVolume(level: number): Promise<void> {
  const res = await fetch(`${API_BASE}/volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function getPictureMode(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/picture-mode`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function setPictureMode(mode: string): Promise<void> {
  const res = await fetch(`${API_BASE}/picture-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function getBrightness(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/brightness`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function adjustBrightness(direction: 'up' | 'down'): Promise<void> {
  const res = await fetch(`${API_BASE}/brightness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function setBrightness(value: number): Promise<void> {
  const res = await fetch(`${API_BASE}/brightness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function getContrast(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/contrast`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function setContrast(value: number): Promise<void> {
  const res = await fetch(`${API_BASE}/contrast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}

export async function getSharpness(): Promise<number | null> {
  const res = await fetch(`${API_BASE}/sharpness`);
  const { error, data } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export async function setSharpness(value: number): Promise<void> {
  const res = await fetch(`${API_BASE}/sharpness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const { error } = await res.json();
  if (error) throw new Error(error);
}
