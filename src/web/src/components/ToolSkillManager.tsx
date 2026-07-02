// src/web/src/components/ToolSkillManager.tsx
// ====================================================
// 工具 & Skill 可视化管理面板
// ====================================================

import { useCallback, useEffect, useState } from "react"
import {
  Box, Button, HStack, IconButton, Input, Text, VStack, Separator, Badge,
  Dialog, Portal,
} from "@chakra-ui/react"
import type { ToolInfo, SkillInfo, ToolReloadResult, SkillReloadResult } from "../types"
import * as api from "../api"

// ── 颜色常量 ──

const SOURCE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  builtin: { bg: "blue.900", color: "blue.300", label: "内置" },
  user: { bg: "green.900", color: "green.300", label: "用户" },
  remote: { bg: "purple.900", color: "purple.300", label: "远程" },
}

type Tab = "tools" | "skills"

interface Props {
  /** 外部刷新 key（License 激活后 etc） */
  refreshKey?: number
}

export function ToolSkillManager({ refreshKey }: Props) {
  const [tab, setTab] = useState<Tab>("tools")
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // ── 添加对话框状态 ──
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState("")
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState("")

  // ── 重载中 ──
  const [reloading, setReloading] = useState(false)
  const [reloadMsg, setReloadMsg] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [t, s] = await Promise.all([
        api.fetchTools().catch((e) => { setError(e.message); return null }),
        api.fetchSkills().catch(() => null),
      ])
      if (t) setTools(t)
      if (s) setSkills(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  // ── 重载 ──

  const handleReload = async () => {
    setReloading(true)
    setReloadMsg("")
    try {
      let result: ToolReloadResult | SkillReloadResult
      if (tab === "tools") {
        result = await api.reloadTools()
      } else {
        result = await api.reloadSkills()
      }
      const total = "total" in result ? result.total : 0
      const errorCount = "errors" in result ? result.errors.length : 0
      setReloadMsg(`✅ 重载完成: ${total} 个${errorCount > 0 ? `, ⚠️ ${errorCount} 个失败` : ""}`)
      await load()
    } catch (e: any) {
      setReloadMsg(`❌ 重载失败: ${e.message}`)
    } finally {
      setReloading(false)
    }
  }

  // ── 删除 ──

  const handleDelete = async (name: string) => {
    if (!confirm(`确定要删除${tab === "tools" ? "工具" : "Skill"} "${name}" 吗？此操作不可恢复。`)) return
    try {
      if (tab === "tools") {
        await api.deleteUserTool(name)
      } else {
        await api.deleteUserSkill(name)
      }
      await load()
    } catch (e: any) {
      alert(`删除失败: ${e.message}`)
    }
  }

  // ── 添加 ──

  const handleAdd = async () => {
    const trimmed = addPath.trim()
    if (!trimmed) {
      setAddMsg("请输入文件夹路径")
      return
    }
    setAdding(true)
    setAddMsg("")
    try {
      if (tab === "tools") {
        await api.addUserTool(trimmed)
      } else {
        await api.addUserSkill(trimmed)
      }
      setAddMsg("✅ 添加成功")
      setAddPath("")
      setAddOpen(false)
      await load()
    } catch (e: any) {
      setAddMsg(`❌ ${e.message}`)
    } finally {
      setAdding(false)
    }
  }

  // ── 数据 ──

  const items = tab === "tools" ? tools : skills
  const itemLabel = tab === "tools" ? "工具" : "Skill"

  // ── 统计 ──

  const builtinCount = items.filter((i) => i.source === "builtin").length
  const userCount = items.filter((i) => i.source === "user").length
  const remoteCount = items.filter((i) => i.source === "remote").length
  const errorCount = items.filter((i) => !i.loaded).length

  return (
    <VStack align="stretch" gap={3}>
      {/* 标签切换 */}
      <HStack gap={0} bg="gray.800" borderRadius="md" p={1}>
        {(["tools", "skills"] as Tab[]).map((t) => (
          <Box
            key={t}
            as="button"
            flex={1}
            py={1.5}
            fontSize="sm"
            fontWeight={tab === t ? "bold" : "normal"}
            borderRadius="md"
            bg={tab === t ? "blue.900" : "transparent"}
            color={tab === t ? "blue.300" : "gray.500"}
            cursor="pointer"
            _hover={{ color: tab === t ? "blue.200" : "gray.400" }}
            onClick={() => setTab(t)}
          >
            {t === "tools" ? "🔧 工具" : "📦 技能"}
          </Box>
        ))}
      </HStack>

      {/* 统计条 */}
      <HStack gap={3} fontSize="xs" color="gray.500">
        <Text>内置: {builtinCount}</Text>
        <Text>用户: {userCount}</Text>
        <Text>远程: {remoteCount}</Text>
        {errorCount > 0 && <Text color="red.400">⚠️ {errorCount} 个加载失败</Text>}
      </HStack>

      {/* 操作按钮 */}
      <HStack gap={2}>
        <Button size="xs" colorPalette="green" variant="subtle" onClick={() => setAddOpen(true)}>
          ➕ 添加{itemLabel}
        </Button>
        <Button size="xs" colorPalette="blue" variant="subtle" onClick={handleReload} loading={reloading}>
          🔄 重新加载
        </Button>
      </HStack>

      {reloadMsg && (
        <Text fontSize="xs" color={reloadMsg.startsWith("❌") ? "red.400" : "green.400"}>
          {reloadMsg}
        </Text>
      )}

      {/* 列表 */}
      {loading && <Text fontSize="sm" color="gray.500">加载中…</Text>}
      {error && <Text fontSize="sm" color="red.400">{error}</Text>}

      {!loading && items.length === 0 && (
        <Text fontSize="sm" color="gray.500">暂无{itemLabel}</Text>
      )}

      <VStack align="stretch" gap={2} maxH="400px" overflowY="auto">
        {items.map((item) => {
          const sc = SOURCE_COLORS[item.source] ?? SOURCE_COLORS.builtin!
          const isDeletable = item.source === "user"
          return (
            <Box
              key={item.name}
              bg="gray.800"
              borderRadius="md"
              p={2.5}
              border="1px solid"
              borderColor={item.loaded ? "gray.700" : "red.900"}
            >
              <HStack justify="space-between" mb={item.error ? 1 : 0}>
                <HStack gap={2} flex={1} minW={0}>
                  <Badge size="xs" colorPalette={item.loaded ? "green" : "red"} variant="subtle">
                    {item.loaded ? "✅" : "⚠️"}
                  </Badge>
                  <Text fontSize="sm" fontWeight="medium" truncate>{item.name}</Text>
                  <Badge size="xs" bg={sc.bg} color={sc.color} variant="subtle">{sc.label}</Badge>
                  {item.category && (
                    <Text fontSize="xs" color="gray.600" display={{ base: "none", md: "inline" }}>
                      {item.category}
                    </Text>
                  )}
                </HStack>
                <HStack gap={1}>
                  {isDeletable && (
                    <IconButton
                      aria-label={`删除 ${item.name}`}
                      size="2xs"
                      variant="ghost"
                      color="red.400"
                      _hover={{ bg: "red.950" }}
                      onClick={() => handleDelete(item.name)}
                    >
                      🗑
                    </IconButton>
                  )}
                </HStack>
              </HStack>
              {item.description && item.loaded && (
                <Text fontSize="xs" color="gray.500" mt={0.5} truncate>{item.description}</Text>
              )}
              {item.error && (
                <Text fontSize="xs" color="red.400" mt={0.5} fontFamily="mono" wordBreak="break-all">
                  {item.error}
                </Text>
              )}
            </Box>
          )
        })}
      </VStack>

      {/* 添加对话框 */}
      <Dialog.Root open={addOpen} onOpenChange={(e) => setAddOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="gray.800" borderColor="gray.600" borderWidth="1px" p={5} boxShadow="dark-lg">
              <Dialog.Header>
                <Dialog.Title color="gray.100">添加{itemLabel}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <VStack align="stretch" gap={3}>
                  <Text fontSize="sm" color="gray.300">
                    输入包含 TOOL.md / SKILL.md 的文件夹路径，系统会将整个文件夹复制到 {itemLabel.toLowerCase()}s/user/ 目录下。
                  </Text>
                  <Box>
                    <Text fontSize="xs" color="gray.500" mb={1}>文件夹路径</Text>
                    <Input
                      size="sm"
                      value={addPath}
                      onChange={(e) => setAddPath(e.target.value)}
                      placeholder="例如: C:\Users\me\my-tools\hello-world"
                      fontFamily="mono"
                      fontSize="xs"
                      bg="gray.800"
                      border="none"
                      color="gray.200"
                      _placeholder={{ color: "gray.500" }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
                    />
                  </Box>
                  {addMsg && (
                    <Text fontSize="xs" color={addMsg.startsWith("❌") ? "red.400" : "green.400"}>
                      {addMsg}
                    </Text>
                  )}
                </VStack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>取消</Button>
                <Button size="sm" colorPalette="green" onClick={handleAdd} loading={adding}>
                  添加
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </VStack>
  )
}
