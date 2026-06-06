import { Layer,Effect } from "effect"
export const memoMap = Effect.runSync(Layer.makeMemoMap)