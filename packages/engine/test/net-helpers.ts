import net from 'node:net';

export interface Listener {
  host: string;
  port: number;
  /** Number of TCP connections accepted. */
  connections(): number;
  close(): Promise<void>;
}

function listen(server: net.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

/** TCP listener that counts accepted connections and drops them. */
export async function countingListener(host: string, port = 0): Promise<Listener> {
  let n = 0;
  const server = net.createServer((s) => { n++; s.destroy(); });
  await listen(server, host, port);
  return {
    host,
    port: (server.address() as net.AddressInfo).port,
    connections: () => n,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface Proxy extends Listener {
  /** `database` value of every Postgres StartupMessage that passed through. */
  startupDatabases(): string[];
}

/**
 * Counting TCP proxy in front of Postgres. It parses the first StartupMessage of each connection
 * (int32 length, int32 protocol 196608, then key\0value\0 pairs) so a test can see which database
 * every connection attempt asked for.
 */
export async function countingProxy(upstream: { host: string; port: number }): Promise<Proxy> {
  let n = 0;
  const dbs: string[] = [];
  const server = net.createServer((client) => {
    n++;
    const up = net.connect(upstream.port, upstream.host);
    let parsed = false;
    client.on('data', (buf) => {
      if (!parsed && buf.length >= 8 && buf.readInt32BE(4) === 196608) {
        parsed = true;
        const parts = buf.subarray(8).toString('utf8').split('\0');
        for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i] === 'database') dbs.push(parts[i + 1]!);
      }
      up.write(buf);
    });
    up.on('data', (d) => client.write(d));
    const end = () => { client.destroy(); up.destroy(); };
    client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
  });
  await listen(server, '127.0.0.1', 0);
  return {
    host: '127.0.0.1',
    port: (server.address() as net.AddressInfo).port,
    connections: () => n,
    startupDatabases: () => [...dbs],
    close: () => new Promise((r) => { server.close(() => r()); }),
  };
}
