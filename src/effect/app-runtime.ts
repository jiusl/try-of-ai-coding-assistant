import { ManagedRuntime } from "effect"
import { AppLayer } from "./app-layer.js"
import { memoMap } from "./memo-map.js"

const rt = ManagedRuntime.make(AppLayer, memoMap)

export const AppRuntime = {
  runPromise: rt.runPromise.bind(rt),
  runSync: rt.runSync.bind(rt),
  runFork: rt.runFork.bind(rt),
  dispose: () => rt.dispose()
}