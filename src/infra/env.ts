import {Context, Effect, Layer} from "effect";

export interface EnvService {
    readonly get : (key:string) => Effect.Effect<string|undefined>
    readonly require : (key:string) => Effect.Effect<string,Error>
}

export class Env extends Context.Tag("Env")<Env,EnvService>() {}

export const EnvLive = Layer.sync(Env,()=>({
    get : (key) => Effect.sync(()=>process.env[key]),
    require: (key) => Effect.sync(()=>process.env[key]).pipe(
        Effect.flatMap(
            value => value ? Effect.succeed(value) : Effect.fail(new Error(`Missing env: ${key}`))
        )
    )
}))