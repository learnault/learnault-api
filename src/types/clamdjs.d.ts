declare module 'clamdjs' {
  export interface Scanner {
    scanStream(stream: NodeJS.ReadableStream, timeout?: number): Promise<string>
    scanBuffer(buffer: Buffer, timeout?: number, chunkSize?: number): Promise<string>
    scanFile(path: string, timeout?: number, chunkSize?: number): Promise<string>
    scanDirectory(rootPath: string, options?: { timeout?: number; chunkSize?: number; endCallback?: (err: Error | null, result: string) => void }): Promise<string>
  }

  export function createScanner(host: string, port: number): Scanner
  export function ping(host: string, port: number, timeout?: number): Promise<string>
  export function version(host: string, port: number, timeout?: number): Promise<string>

  const _default: {
    createScanner: typeof createScanner
    ping: typeof ping
    version: typeof version
  }
  export default _default
}
