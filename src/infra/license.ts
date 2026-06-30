// src/infra/license.ts
// ====================================================
// License 授权机制 — RSA 签名验证 + 分级控制
//
// 安全模型:
//   1. 公钥编译进二进制（LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUEwbC9DUUw4S1h0VGdTTlBJY1IxaApOMkxvTzRXZkRSUDJPQWE1NEZFTzFaSnpEa0RFWS9tOGV3dDlGOGQydlB6aks2K1dRNnRsMVFSbFhsaTJac05sCkxFS3ZoQXMrMFhwU0tjR1NpUm51MFhGOWRmdjFRTTFrWm41RVp0T0xQQTgwZ2t2V29WWm1CWFhTREZJLzJKQzMKL1NOQWwzbXFZZ2wrZnArVDVpUUZ4bnIrRHNyaWZFMWFJYWlmZ3lxWUQ4aDR6Q2trcHNRc2lNblZLbjJsaldlMgo1NGJVT3J3M1ErM1UySFJZOHJJZTdaNElWcDVEZU16dGZKZXZrZGVDazlwR2JkdEJqclpyRXYvQ2FGTDVlQkNFClZlcEpZaTFvNmJzb3NkVjQ0UGZZUDRlMXc1UjAzOG1ueitrcko0cWNGSFpBb0xQZnZpMW9yWEJDOXM3NjI2NmEKUXdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0t 在构建时替换）
//   2. license.json 包含 RSA-SHA256 签名
//   3. 启动时验证签名 → 确定用户等级
//   4. 无效/缺失 → 强制免费版（hard limits）
//   5. 用户无法伪造签名（没有私钥）
//   6. 用户难以修改二进制中的公钥（需要逆向工程）
// ====================================================

import { createVerify } from "crypto"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { logger } from "./logger.js"

// ====================================================
// 编译时注入的公钥（base64 编码，构建脚本会替换此值）
// 使用模板字符串以支持跨行 base64
// ====================================================
const EMBEDDED_PUBLIC_KEY_BASE64: string = `BUILD_PUBLIC_KEY_BASE64`

function getPublicKey(): string {
  return Buffer.from(EMBEDDED_PUBLIC_KEY_BASE64, "base64").toString("utf-8")
}

// ====================================================
// 等级 → 限额 / 功能 映射
// ====================================================

type TierId = "free" | "pro" | "enterprise"

interface TierConfig {
  maxUsers: number
  maxSessions: number
  features: LicenseFeatures
}

const TIER_CONFIGS: Record<TierId, TierConfig> = {
  free: {
    maxUsers: 1,
    maxSessions: 3,
    features: {
      multiUser: false,
      apiAccess: true,
      sseStream: true,
      toolCalls: true,
      skillExecution: true,
      auditLog: false,
      metrics: false,
      modelSwitching: false,
    },
  },
  pro: {
    maxUsers: 5,
    maxSessions: 50,
    features: {
      multiUser: true,
      apiAccess: true,
      sseStream: true,
      toolCalls: true,
      skillExecution: true,
      auditLog: true,
      metrics: true,
      modelSwitching: true,
    },
  },
  enterprise: {
    maxUsers: 999,
    maxSessions: 999,
    features: {
      multiUser: true,
      apiAccess: true,
      sseStream: true,
      toolCalls: true,
      skillExecution: true,
      auditLog: true,
      metrics: true,
      modelSwitching: true,
    },
  },
}

// ====================================================
// 公开类型（保持向后兼容）
// ====================================================

export interface LicenseInfo {
  id: number
  licenseKey: string
  licensee: string | null
  product: string
  maxUsers: number
  maxSessions: number
  features: Record<string, boolean>
  issuedAt: string
  expiresAt: string | null
  activatedAt: string | null
  revokedAt: string | null
  status: "inactive" | "active" | "expired" | "revoked"
}

export interface LicenseValidationResult {
  valid: boolean
  reason?: string
  info?: LicenseInfo
}

export interface LicenseFeatures {
  multiUser: boolean
  apiAccess: boolean
  sseStream: boolean
  toolCalls: boolean
  skillExecution: boolean
  auditLog: boolean
  metrics: boolean
  modelSwitching: boolean
}

// ====================================================
// License 文件结构（RSA 签名）
// ====================================================

interface SignedLicense {
  tier: TierId
  issuedAt: string
  expiresAt: string
  userId: string
  signature: string
}

// ====================================================
// 内部状态（内存缓存，只加载一次）
// ====================================================

let _cachedTier: TierId | null = null
let _cachedPayload: SignedLicense | null = null
let _cachedValid: boolean | null = null

function getLicensePath(): string {
  return process.env.TRY_LICENSE_PATH ?? "./license.json"
}

// ====================================================
// 开发模式检测
// ====================================================

/**
 * 开发模式检测：
 * - 默认即开发模式（未设置 TRY_DEV_MODE 时）
 * - 只有显式设置 TRY_DEV_MODE=false 或 0 才进入正式模式
 */
function isDevMode(): boolean {
  const val = process.env.TRY_DEV_MODE
  if (val === undefined || val === null || val === "") return true
  return val !== "false" && val !== "0"
}

// ====================================================
// RSA 签名验证核心
// ====================================================

function verifySignedLicense(raw: string): { valid: boolean; payload: SignedLicense | null; error?: string } {
  try {
    const license: SignedLicense = JSON.parse(raw)

    // 字段完整性检查
    if (!license.tier || !license.issuedAt || !license.expiresAt) {
      return { valid: false, payload: null, error: "License 文件格式无效（缺少必要字段）" }
    }

    const VALID_TIERS = ["free", "pro", "enterprise"]
    if (!VALID_TIERS.includes(license.tier)) {
      return { valid: false, payload: null, error: `无效的等级: ${license.tier}` }
    }

    // 过期检查
    if (new Date(license.expiresAt) < new Date()) {
      return { valid: false, payload: null, error: `License 已过期 (${license.expiresAt})` }
    }

    // 开发模式：跳过签名验证
    if (isDevMode()) {
      return { valid: true, payload: license }
    }

    // 正式模式：RSA-SHA256 签名验证
    if (!license.signature) {
      return { valid: false, payload: null, error: "License 文件缺少签名" }
    }

    const { signature, ...payload } = license
    const payloadJson = JSON.stringify(payload)

    const verify = createVerify("SHA256")
    verify.update(payloadJson)
    verify.end()

    const ok = verify.verify(getPublicKey(), signature, "base64")

    if (!ok) {
      return { valid: false, payload: null, error: "License 签名验证失败 — 文件可能被篡改" }
    }

    return { valid: true, payload: license }
  } catch (err: any) {
    return { valid: false, payload: null, error: `License 解析失败: ${err.message}` }
  }
}

function loadAndCache(): void {
  if (_cachedTier !== null) return // 已缓存

  const path = getLicensePath()

  if (!existsSync(path)) {
    logger.info("未找到 license.json，使用免费版")
    _cachedValid = false
    _cachedTier = "free"
    _cachedPayload = null
    return
  }

  try {
    const raw = readFileSync(path, "utf-8")
    const result = verifySignedLicense(raw)

    if (result.valid && result.payload) {
      _cachedValid = true
      _cachedTier = result.payload.tier
      _cachedPayload = result.payload
      logger.info(`License 验证通过: ${result.payload.tier}`, {
        issuedAt: result.payload.issuedAt,
        expiresAt: result.payload.expiresAt,
      })
    } else {
      logger.warn(`License 验证失败: ${result.error}，降级为免费版`)
      _cachedValid = false
      _cachedTier = "free"
      _cachedPayload = null
    }
  } catch (err: any) {
    logger.warn(`License 读取失败: ${err.message}，降级为免费版`)
    _cachedValid = false
    _cachedTier = "free"
    _cachedPayload = null
  }
}

// ====================================================
// 辅助：构建 LicenseInfo
// ====================================================

function buildLicenseInfo(tier: TierId, payload?: SignedLicense | null): LicenseInfo {
  const cfg = TIER_CONFIGS[tier]
  return {
    id: 1,
    licenseKey: payload ? `${payload.tier}-${payload.userId}`.slice(0, 12) : "community-free",
    licensee: payload?.userId ?? "社区版",
    product: "try",
    maxUsers: cfg.maxUsers,
    maxSessions: cfg.maxSessions,
    features: { ...cfg.features },
    issuedAt: payload?.issuedAt ?? new Date().toISOString(),
    expiresAt: payload?.expiresAt ?? null,
    activatedAt: payload?.issuedAt ?? new Date().toISOString(),
    revokedAt: null,
    status: "active",
  }
}

// ====================================================
// LicenseService（保持 API 兼容）
// ====================================================

class LicenseService {
  /**
   * 获取当前生效的等级 ID
   */
  getTier(): TierId {
    loadAndCache()
    return _cachedTier ?? "free"
  }

  /**
   * 激活 License：
   *   - 正式模式：接受签名后的 license JSON 字符串，验证 RSA 签名
   *   - 开发模式：接受 tier 名称（pro/enterprise），自动签发
   * 验证签名通过后写入 license.json
   */
  activate(licenseKey: string, licensee?: string): LicenseValidationResult {
    // 开发模式：接受 tier 名称，自动签发
    if (isDevMode()) {
      const VALID_TIERS = ["free", "pro", "enterprise"]
      const tier = VALID_TIERS.includes(licenseKey.trim()) ? licenseKey.trim() : "pro"

      const now = new Date().toISOString()
      const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      const devLicense: SignedLicense = {
        tier: tier as TierId,
        issuedAt: now,
        expiresAt: expires,
        userId: licensee ?? "dev-user",
        signature: "DEV_MODE_SKIP",
      }

      try {
        writeFileSync(getLicensePath(), JSON.stringify(devLicense, null, 2) + "\n", "utf-8")
        _cachedTier = null
        _cachedValid = null
        _cachedPayload = null
        loadAndCache()
        const effectiveTier = _cachedTier ?? "free"
        logger.info(`[DevMode] License 已签发: ${effectiveTier}`, { userId: devLicense.userId })
        return {
          valid: true,
          info: buildLicenseInfo(effectiveTier, _cachedPayload ?? devLicense),
        }
      } catch (err: any) {
        return { valid: false, reason: `写入失败: ${err.message}` }
      }
    }

    // 正式模式：需要完整的 RSA 签名 License JSON
    // 先检测是否为纯 tier 名称（开发模式遗留）
    const VALID_TIERS2 = ["free", "pro", "enterprise"]
    if (VALID_TIERS2.includes(licenseKey.trim())) {
      return {
        valid: false,
        reason: `正式模式下需要完整签名的 License JSON，不能直接输入 "${licenseKey.trim()}"。请在开发模式下运行（不设置 TRY_DEV_MODE 即可）`,
      }
    }

    const result = verifySignedLicense(licenseKey)
    if (!result.valid) {
      return { valid: false, reason: result.error }
    }

    try {
      // 写入 license.json
      writeFileSync(getLicensePath(), JSON.stringify(JSON.parse(licenseKey), null, 2) + "\n", "utf-8")
      // 清除缓存，下次 validate() 会重新加载
      _cachedTier = null
      _cachedValid = null
      _cachedPayload = null

      // 立即加载并验证
      loadAndCache()
      const tier = _cachedTier ?? "free"
      logger.info("License 激活成功", { tier, licensee })
      return {
        valid: true,
        info: buildLicenseInfo(tier, _cachedPayload),
      }
    } catch (err: any) {
      logger.error("License 写入失败", { error: String(err) })
      return { valid: false, reason: `写入失败: ${err.message}` }
    }
  }

  /**
   * 验证 License 状态（启动时调用）
   */
  validate(): LicenseValidationResult {
    loadAndCache()
    const tier = _cachedTier ?? "free"

    if (_cachedValid) {
      return { valid: true, info: buildLicenseInfo(tier, _cachedPayload) }
    }

    // 免费版也算"有效"（不阻止启动，只是功能受限）
    return {
      valid: true,
      info: buildLicenseInfo("free", null),
    }
  }

  /**
   * 获取当前 License 信息
   */
  getCurrent(): LicenseInfo | null {
    loadAndCache()
    const tier = _cachedTier ?? "free"
    return buildLicenseInfo(tier, _cachedPayload)
  }

  /**
   * 吊销 License（删除 license.json）
   */
  revoke(_licenseKey: string): boolean {
    try {
      const { unlinkSync } = require("fs")
      const path = getLicensePath()
      if (existsSync(path)) {
        unlinkSync(path)
        _cachedTier = null
        _cachedValid = null
        _cachedPayload = null
        logger.warn("License 已吊销")
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * 获取功能开关
   */
  getFeatures(): LicenseFeatures {
    loadAndCache()
    const tier = _cachedTier ?? "free"
    return { ...TIER_CONFIGS[tier].features }
  }

  /**
   * 检查是否超过用户上限
   */
  checkUserLimit(currentUserCount: number): { ok: boolean; limit: number } {
    loadAndCache()
    const tier = _cachedTier ?? "free"
    const limit = TIER_CONFIGS[tier].maxUsers
    return {
      ok: currentUserCount <= limit,
      limit,
    }
  }
}

/** 全局 License 服务单例 */
export const licenseService = new LicenseService()
