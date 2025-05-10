import { EventEmitter } from "events";
import * as Network from "expo-network";
import { Platform } from "react-native";

// Using a fake TcpServer for development/testing on web
// This would be replaced with actual TCP implementation in a native context
class TcpServer {
  private eventEmitter = new EventEmitter();
  private isRunning = false;
  private port: number;
  private clients: any[] = [];
  private serverIp: string | null = null;

  constructor(port: number = 8080) {
    this.port = port;
    this.eventEmitter.setMaxListeners(20);
  }

  async start(): Promise<string | null> {
    if (this.isRunning) return this.serverIp;

    try {
      // Get the device's IP address
      const networkInfo = await Network.getIpAddressAsync();
      this.serverIp = networkInfo;
      this.isRunning = true;

      console.log(`TCP Server started on ${this.serverIp}:${this.port}`);

      // For demo purposes, simulate receiving data periodically
      if (Platform.OS === "web" || __DEV__) {
        this._startDemoDataStream();
      }

      return this.serverIp;
    } catch (error) {
      console.error("Failed to start TCP server:", error);
      return null;
    }
  }

  stop(): void {
    this.isRunning = false;
    this.clients = [];
    this.serverIp = null;
    console.log("TCP Server stopped");
  }

  getStatus(): {
    isRunning: boolean;
    address: string | null;
    port: number;
    clients: number;
  } {
    return {
      isRunning: this.isRunning,
      address: this.serverIp,
      port: this.port,
      clients: this.clients.length,
    };
  }

  sendToAll(data: any): void {
    if (!this.isRunning || this.clients.length === 0) return;

    // In a real implementation, we would iterate through clients and send data
    console.log("Sending data to all clients:", data);
  }

  sendToClient(clientId: string, data: any): void {
    if (!this.isRunning) return;

    const client = this.clients.find((c) => c.id === clientId);
    if (client) {
      console.log(`Sending data to client ${clientId}:`, data);
    }
  }

  // Event listeners
  on(
    event: "connection" | "data" | "disconnection" | "error",
    listener: (...args: any[]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  off(
    event: "connection" | "data" | "disconnection" | "error",
    listener: (...args: any[]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  // For demo purposes - this simulates receiving ECG data
  private _startDemoDataStream(): void {
    // Only start the demo if we're running
    if (!this.isRunning) return;

    // Simulate a client connection after 1 second
    setTimeout(() => {
      const mockClient = { id: "mock-stm32-client", name: "STM32-ECG-Device" };
      this.clients.push(mockClient);
      this.eventEmitter.emit("connection", mockClient);

      // Simulate ECG data every 100ms (10Hz for demo)
      let lastValue = 512; // Middle of 10-bit ADC range
      const ecgInterval = setInterval(() => {
        if (!this.isRunning) {
          clearInterval(ecgInterval);
          return;
        }

        // Generate a somewhat realistic ECG-like pattern
        // This is just for visualization demo purposes
        const ecgData = this._generateMockEcgData(lastValue);
        lastValue = ecgData[ecgData.length - 1];

        this.eventEmitter.emit("data", {
          clientId: mockClient.id,
          dataType: "ecg",
          timestamp: Date.now(),
          data: ecgData,
        });
      }, 100);
    }, 1000);
  }

  // Generate mock ECG data that looks somewhat like a real ECG
  private _generateMockEcgData(lastValue: number): number[] {
    const data = [];
    let value = lastValue;

    // Generate 10 points per frame (for demo)
    for (let i = 0; i < 10; i++) {
      // Add some random noise
      value += Math.random() * 10 - 5;

      // Every ~50 points, generate a heartbeat pattern
      if (Math.random() < 0.02) {
        // P wave (small bump up)
        value += 50;
        data.push(Math.round(value));

        // QRS complex (big spike)
        value += 300;
        data.push(Math.round(value));
        value -= 400;
        data.push(Math.round(value));

        // T wave (medium bump up)
        value += 200;
        data.push(Math.round(value));

        // Return to baseline
        value = 512 + (Math.random() * 20 - 10);
      }

      // Keep within 10-bit ADC range (0-1023)
      value = Math.max(0, Math.min(1023, value));
      data.push(Math.round(value));
    }

    return data;
  }
}

// Export a singleton instance
export const tcpServer = new TcpServer();
