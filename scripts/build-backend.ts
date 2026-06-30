// scripts/build-backend.ts
// ====================================================
// 后端构建脚本 — 注入公钥 → 编译二进制
//
// 用法:
//   bun run build:backend                    # 编译 JS bundle
//   bun run build:backend --compile           # 编译二进制(.exe)
// ====================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"

const DIST_DIR = "dist"
const LICENSE_TS = "src/infra/license.ts"
const ENTRY = "src/bin/try.ts"
const OUTFILE = "dist/try.js"
const BINARY_OUT = "dist/try-bin"

// ====================================================
// 1. 读取公钥
// ====================================================
let publicKey: string
try {
  publicKey = readFileSync("license_public.pem", "utf-8").trim()
  console.log("✅ 读取公钥 (license_public.pem)")
} catch {
  console.error("❌ 找不到 license_public.pem，请先运行: bun run gen-keys")
  process.exit(1)
}

// ====================================================
// 2. 备份 license.ts 并注入公钥 (base64 编码)
// ====================================================
const original = readFileSync(LICENSE_TS, "utf-8")
const PLACEHOLDER = "BUILD_PUBLIC_KEY_BASE64"

if (!original.includes(PLACEHOLDER)) {
  console.error(`❌ ${LICENSE_TS} 中找不到占位符 "${PLACEHOLDER}"`)
  process.exit(1)
}

// PEM 格式包含换行符，直接注入会破坏 JS 语法
// 转成 base64 字符串注入，运行时再 decode
const publicKeyBase64 = Buffer.from(publicKey, "utf-8").toString("base64")
const injected = original.replaceAll(PLACEHOLDER, publicKeyBase64)
writeFileSync(LICENSE_TS, injected, "utf-8")
console.log(`✅ 公钥 (base64) 已注入 ${LICENSE_TS}`)

// ====================================================
// 3. 编译
// ====================================================
const shouldCompile = process.argv.includes("--compile")

try {
  if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR)

  if (shouldCompile) {
    console.log("🔨 编译二进制...")
    const result = Bun.spawnSync({
      cmd: ["bun", "build", ENTRY, "--outfile", BINARY_OUT, "--target", "bun", "--compile",
        "--external", "node-llama-cpp", "--external", "@node-llama-cpp/*"],
      stdout: "pipe",
      stderr: "pipe",
    })
    console.log(new TextDecoder().decode(result.stdout))
    if (result.exitCode !== 0) {
      console.error(new TextDecoder().decode(result.stderr))
      process.exit(result.exitCode)
    }
    console.log(`✅ 二进制编译完成: ${BINARY_OUT}.exe`)
  } else {
    console.log("🔨 编译 JS bundle...")
    const result = Bun.spawnSync({
      cmd: ["bun", "build", ENTRY, "--outfile", OUTFILE, "--target", "bun",
        "--external", "node-llama-cpp", "--external", "@node-llama-cpp/*"],
      stdout: "pipe",
      stderr: "pipe",
    })
    console.log(new TextDecoder().decode(result.stdout))
    if (result.exitCode !== 0) {
      console.error(new TextDecoder().decode(result.stderr))
      process.exit(result.exitCode)
    }
    console.log(`✅ JS bundle 编译完成: ${OUTFILE}`)
  }
} finally {
  // ====================================================
  // 4. 恢复原始 license.ts（不污染源码仓库）
  // ====================================================
  writeFileSync(LICENSE_TS, original, "utf-8")
  console.log("✅ 已恢复 license.ts 原始内容")
}
