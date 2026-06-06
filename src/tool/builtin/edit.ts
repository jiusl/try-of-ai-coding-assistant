// src/tool/builtin/edit.ts
import { Effect, Schema } from "effect"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import type { ToolDefinition } from "../types.js"
import { EditInput, ToolExecutionError } from "../types.js"

const EditInputSchema = Schema.Struct({
  filePath: Schema.String,
  oldString: Schema.String,
  newString: Schema.String
})

export const EditTool: ToolDefinition<typeof EditInput.Type, string> = {
  name: "edit_file",
  description: "Edit a file by replacing occurrences of oldString with newString.",
  category: "file",
  permission: "write",
  inputSchema: EditInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const fullPath = resolve(context.workspaceRoot, input.filePath)
      
      const content = yield* Effect.tryPromise({
        try: () => readFile(fullPath, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "edit_file",
          message: `Failed to read file: ${input.filePath}`,
          cause: error
        })
      })
      
      if (!content.includes(input.oldString)) {
        return yield* Effect.fail(new ToolExecutionError({
          toolName: "edit_file",
          message: `String not found in file: ${input.oldString}`
        }))
      }
      
      const newContent = content.replaceAll(input.oldString, input.newString)
      
      yield* Effect.tryPromise({
        try: () => writeFile(fullPath, newContent, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "edit_file",
          message: `Failed to write file: ${input.filePath}`,
          cause: error
        })
      })
      
      return `Successfully edited ${input.filePath} (replaced "${input.oldString}" with "${input.newString}")`
    })
}