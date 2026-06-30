// src/web/src/components/TierPanel.tsx
// ====================================================
// 用户等级面板 — 展示当前等级、配额、权限，支持切换
// ====================================================

import { useCallback, useEffect, useState } from "react"
import {
  Badge, Box, Button, HStack, Progress, Text, VStack, Flex,
  Separator,
} from "@chakra-ui/react"
import type { QuotaInfo, TierInfo } from "../types"
import * as api from "../api"
import { useToast } from "./Toast"

// ── 等级样式映射 ──

const TIER_COLORS: Record<string, { badge: string; border: string; bar: string; bg: string }> = {
  free:       { badge: "gray",    border: "gray.600",    bar: "gray",    bg: "gray.800" },
  pro:        { badge: "blue",   border: "blue.500",    bar: "blue",    bg: "blue.900" },
  enterprise: { badge: "purple", border: "purple.500",   bar: "purple",  bg: "purple.900" },
}

// ── 格式化数字 ──

function fmt(n: number | null): string {
  return n === null ? "∞" : String(n)
}

// ── 组件 ──

export function TierPanel({ refreshKey }: { refreshKey?: number }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [tiers, setTiers] = useState<TierInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [q, t] = await Promise.all([api.fetchQuota(), api.fetchTiers()])
      setQuota(q)
      setTiers(t)
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  const handleSwitch = async (tierId: string) => {
    setSwitching(tierId)
    try {
      const result = await api.switchMyTier(tierId)
      // 更新本地配额显示
      setQuota(result.remaining)
      toast.success("等级已切换", `已切换至 ${result.tier.name}`)
    } catch (e: any) {
      toast.error("切换失败", e.message || "未知错误")
    } finally {
      setSwitching(null)
    }
  }

  if (loading) {
    return <Text color="gray.500" fontSize="sm">加载中…</Text>
  }

  const currentTierId = quota?.tierId || "free"
  const colors = TIER_COLORS[currentTierId] || TIER_COLORS.free!

  return (
    <VStack align="stretch" gap={4}>
      {/* ── 当前等级卡片 ── */}
      <Box
        bg={colors.bg} borderRadius="lg" p={4}
        border="1px solid" borderColor={colors.border}
      >
        <HStack justify="space-between" mb={3}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="bold" color="white">当前等级</Text>
            <Badge colorPalette={colors.badge} variant="solid" size="lg">
              {quota?.tierName || "免费版"}
            </Badge>
          </HStack>
          {quota?.tierInfo?.expiresAt && (
            <Text fontSize="xs" color="gray.400">
              {quota.tierInfo.isExpired ? "已过期" : `到期: ${new Date(quota.tierInfo.expiresAt).toLocaleDateString()}`}
            </Text>
          )}
        </HStack>

        {/* ── 配额用量条 ── */}
        <VStack align="stretch" gap={2}>
          <QuotaBar
            label="每日对话"
            used={quota?.dailyChats.used || 0}
            limit={quota?.dailyChats.limit || null}
            color={colors.bar}
          />
          <QuotaBar
            label="会话数"
            used={quota?.maxSessions.current || 0}
            limit={quota?.maxSessions.limit || null}
            color={colors.bar}
          />
        </VStack>

        {/* ── 配额用尽重置提示 ── */}
        {quota?.resetAt && (
          <Text fontSize="xs" color="orange.300" mt={3}>
            ⏳ 配额已用尽，将于明天 {new Date(quota.resetAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })} 重置
          </Text>
        )}
      </Box>

      <Separator borderColor="gray.700" />

      {/* ── 切换等级 ── */}
      <Box>
        <Text fontSize="sm" fontWeight="bold" color="gray.300" mb={1}>
          📈 升级 / 切换等级
        </Text>
        <Text fontSize="xs" color="yellow.400" mb={3}>
          ⚠ 开发模式：当前可自由切换等级，无需支付验证。后续将接入支付流程。
        </Text>
        <VStack align="stretch" gap={2}>
          {tiers.map((tier) => {
            const isCurrent = tier.id === currentTierId
            const tc = TIER_COLORS[tier.id] || TIER_COLORS.free!
            return (
              <Flex
                key={tier.id}
                bg="gray.800" borderRadius="md" p={3}
                border="1px solid"
                borderColor={isCurrent ? tc.border : "gray.700"}
                justify="space-between"
                align="center"
                opacity={isCurrent ? 0.6 : 1}
              >
                <VStack align="start" gap={0.5}>
                  <HStack gap={2}>
                    <Badge colorPalette={tc.badge} variant="subtle">{tier.name}</Badge>
                    {isCurrent && <Text fontSize="xs" color="gray.500">当前</Text>}
                  </HStack>
                  <Text fontSize="xs" color="gray.500">
                    对话 {fmt(tier.dailyChats)}/天 · {fmt(tier.maxSessions)} 会话
                  </Text>
                </VStack>
                <Button
                  size="xs"
                  colorPalette={tc.badge}
                  variant={isCurrent ? "outline" : "solid"}
                  disabled={isCurrent || switching !== null}
                  loading={switching === tier.id}
                  onClick={() => handleSwitch(tier.id)}
                >
                  {isCurrent ? "使用中" : "切换"}
                </Button>
              </Flex>
            )
          })}
        </VStack>
      </Box>
    </VStack>
  )
}

// ── 配额进度条 ──

function QuotaBar({ label, used, limit, color }: {
  label: string
  used: number
  limit: number | null
  color: string
}) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const isUnlimited = limit === null
  const isExhausted = !isUnlimited && used >= limit!

  return (
    <Box>
      <HStack justify="space-between" mb={0.5}>
        <Text fontSize="xs" color="gray.400">{label}</Text>
        <Text fontSize="xs" color={isExhausted ? "red.400" : "gray.400"}>
          {isUnlimited ? "无限制" : `${used}/${limit}`}
        </Text>
      </HStack>
      {!isUnlimited && (
        <Progress.Root size="xs" colorPalette={color} value={pct}>
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      )}
    </Box>
  )
}
