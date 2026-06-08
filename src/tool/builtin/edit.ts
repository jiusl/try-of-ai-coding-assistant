// src/tool/builtin/edit.ts
import { Effect, Schema } from "effect"
import { readFile, writeFile } from "fs/promises"
import { resolve, isAbsolute } from "path"
import type { ToolDefinition } from "../types.js"
import { EditInput, ToolExecutionError } from "../types.js"

const EditInputSchema = Schema.Struct({
  filePath: Schema.String,
  oldString: Schema.String,
  newString: Schema.String
})

export const EditTool: ToolDefinition<typeof EditInput.Type, string> = {
  name: "edit_file",
  description: "Edit a file by replacing occurrences of oldString with newString. Supports absolute paths and relative paths.",
  category: "file",
  permission: "write",
  inputSchema: EditInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const fullPath = isAbsolute(input.filePath)
        ? input.filePath
        : resolve(context.workspaceRoot, input.filePath)
      
      const content = yield* Effect.tryPromise({
        try: () => readFile(fullPath, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "edit_file",
          message: `读取文件失败: ${input.filePath}`,
          cause: error
        })
      })
      
      if (!content.includes(input.oldString)) {
        return yield* Effect.fail(new ToolExecutionError({
          toolName: "edit_file",
          message: `文件中未找到指定内容: ${input.oldString}`
        }))
      }
      
      const newContent = content.replaceAll(input.oldString, input.newString)
      
      yield* Effect.tryPromise({
        try: () => writeFile(fullPath, newContent, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "edit_file",
          message: `写入文件失败: ${input.filePath}`,
          cause: error
        })
      })
      
      return `成功编辑 ${input.filePath}（将 "${input.oldString}" 替换为 "${input.newString}"）`
    })
}