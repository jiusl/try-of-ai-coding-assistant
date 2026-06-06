import { Context, Effect, Layer } from "effect"
import * as fs from "fs/promises"

export interface FsService {
    readonly readFile: (path:string) => Effect.Effect<string,Error>
    readonly writeFile: (path:string, content:string) => Effect.Effect<void,Error>
    readonly exists: (path:string) => Effect.Effect<boolean,boolean>
}

export class Fs extends Context.Tag("Fs")<Fs,FsService>() {}

export const FsLive = Layer.sync(Fs,() => ({
    readFile: (path) => Effect.tryPromise({
        try: () => fs.readFile(path,"utf-8"),
        catch: (error) => new Error(`Failed to read file: ${path}, error: ${error}`)
    }),
    writeFile: (path, content) => Effect.tryPromise({
        try: () => fs.writeFile(path, content, "utf-8"),
        catch: (error) => new Error(`Failed to write file: ${path}, error: ${error}`)
    }),
    exists: (path) => Effect.tryPromise({
        try: () => fs.access(path).then(() => true).catch(() => false),
        catch: () => false
    })
}))
