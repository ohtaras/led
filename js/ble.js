import { SERVICE_UUID, CHARACTERISTIC_UUID } from './protocol.js';

/**
 * List Bluetooth devices this page has previously been granted permission
 * to access (Web Bluetooth "persistent permissions"), so they can be
 * reconnected without showing the chooser dialog again. Returns [] if the
 * browser doesn't support this (e.g. Firefox/Safari, or no prior grants).
 */
export async function getKnownDevices() {
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
    return [];
  }
  return navigator.bluetooth.getDevices();
}

/**
 * Manages the Web Bluetooth connection to a CoolLEDX sign and serializes
 * writes to its single write/notify characteristic, mirroring the reference
 * driver's behavior of waiting for the device's notification before sending
 * the next chunk of a multi-chunk transfer.
 */
export class CoolLedClient extends EventTarget {
  /**
   * `device`, when given, is an already-permitted BluetoothDevice (e.g. from
   * navigator.bluetooth.getDevices()) to connect straight to, skipping the
   * chooser dialog. Omit it to prompt the user to pick a new device.
   */
  constructor(device = null) {
    super();
    this.device = device;
    this.characteristic = null;
    this._notifyResolve = null;
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  get deviceName() {
    return this.device ? this.device.name : null;
  }

  get deviceId() {
    return this.device ? this.device.id : null;
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not available in this browser.');
    }
    if (!this.device) {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'CoolLED' }],
        optionalServices: [SERVICE_UUID],
      });
    }
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnect());

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e));

    this.dispatchEvent(new Event('connected'));
  }

  disconnect() {
    if (this.connected) {
      this.device.gatt.disconnect();
    }
  }

  _onNotify(event) {
    if (this._notifyResolve) {
      const resolve = this._notifyResolve;
      this._notifyResolve = null;
      resolve(event.target.value);
    }
  }

  _onDisconnect() {
    this.characteristic = null;
    this.dispatchEvent(new Event('disconnected'));
  }

  _waitForNotify(timeoutMs = 2000) {
    return new Promise((resolve) => {
      this._notifyResolve = resolve;
      setTimeout(() => {
        if (this._notifyResolve === resolve) {
          this._notifyResolve = null;
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  /**
   * Send a sequence of already-framed wire packets. When `expectNotify` is
   * true, each chunk waits (briefly) for the device's ack notification
   * before the next one is sent, same as the official app does for
   * multi-chunk text/image transfers.
   */
  async sendPackets(packets, { expectNotify = true } = {}) {
    if (!this.characteristic) {
      throw new Error('Not connected to a sign.');
    }
    for (const packet of packets) {
      const notifyPromise = expectNotify ? this._waitForNotify() : Promise.resolve();
      await this.characteristic.writeValueWithResponse(packet);
      await notifyPromise;
    }
  }
}
