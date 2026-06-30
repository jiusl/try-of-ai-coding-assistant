// scripts/sign-license.ts
// ====================================================
// License 签名工具 — 开发者使用，不部署
// 用法: bun run sign-license --tier pro [--expires 2026-01-01]
// ====================================================

import { createSign } from "crypto"
import { parseArgs } from "util"

// ====================================================
// 解析命令行参数
// ====================================================
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    tier:      { type: "string", default: "free" },
    expires:   { type: "string", default: "2099-12-31" },
    user:      { type: "string", default: "default" },
    privkey:   { type: "string", default: "license_private.pem" },
    out:       { type: "string", default: "license.json" },
  },
  strict: true,
})

const TIER_IDS = ["free", "pro", "enterprise"] as const
if (!TIER_IDS.includes(values.tier as any)) {
  console.error(`❌ 无效的 tier: ${values.tier}，可选: ${TIER_IDS.join(", ")}`)
  process.exit(1)
}

// ====================================================
// 读取私钥
// ====================================================
let privateKey: string
try {
  privateKey = await Bun.file(values.privkey).text()
} catch {
  console.error(`❌ 找不到私钥文件: ${values.privkey}`)
  console.error("   请先运行: bun run gen-keys  来生成密钥对")
  process.exit(1)
}

// ====================================================
// 构造 License 数据
// ====================================================
const payload = {
  tier: values.tier,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(values.expires).toISOString(),
  userId: values.user,
}

const payloadJson = JSON.stringify(payload)

// ====================================================
// RSA-SHA256 签名
// ====================================================
const sign = createSign("SHA256")
sign.update(payloadJson)
sign.end()
const signature = sign.sign(privateKey, "base64")

// ====================================================
// 输出完整 license 文件
// ====================================================
const license = {
  ...payload,
  signature,
}

await Bun.write(values.out, JSON.stringify(license, null, 2) + "\n")

console.log(`✅ License 已签名并写入 ${values.out}`)
console.log(`   等级: ${license.tier}`)
console.log(`   签发: ${license.issuedAt}`)
console.log(`   过期: ${license.expiresAt}`)
console.log(`   用户: ${license.userId}`)
