// src/web/src/components/SettingsDrawer.tsx
// ====================================================
// 设置抽屉面板
// ====================================================

import { useEffect, useMemo, useState } from "react"
import {
  Box, Button, Code, HStack, IconButton, Input, Select, Slider, Text, VStack, Separator, Wrap,
  createListCollection,
} from "@chakra-ui/react"
import type { AppConfig, LicenseInfo, ProviderName } from "../types"
import * as api from "../api"
import { TierPanel } from "./TierPanel"
import { ToolSkillManager } from "./ToolSkillManager"

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  /** 配额刷新版本号 — 父组件递增时 TierPanel 重新加载 */
  quotaVersion?: number
  /** License 激活成功后触发，用于刷新配额 UI */
  onLicenseActivated?: () => void
}

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o3-mini", "o1", "o1-mini"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3.5-sonnet", "claude-3.5-haiku", "claude-3-opus"],
  deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"],
  ollama: ["qwen2.5-0.5b-instruct", "qwen2.5-7b-instruct", "llama3.2-3b-instruct", "codellama-7b-instruct", "deepseek-r1-8b", "mistral-7b-instruct"],
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  ollama: "Ollama (本地)",
}

export function SettingsDrawer({ open, onClose, quotaVersion, onLicenseActivated }: SettingsDrawerProps) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  // ── License 激活状态 ──
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null)
  const [licenseInput, setLicenseInput] = useState("")
  const [activating, setActivating] = useState(false)
  const [licenseMsg, setLicenseMsg] = useState("")

  useEffect(() => {
    if (open) {
      setLoading(true)
      api.fetchConfig()
        .then(setConfig)
        .catch(() => setStatusMsg("加载设置失败"))
        .finally(() => setLoading(false))

      // 同时获取 License 状态
      api.fetchLicense()
        .then(setLicenseInfo)
        .catch(() => {})
    }
  }, [open])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      await api.saveConfig(config)
      setStatusMsg("✅ 设置已保存")
      setTimeout(onClose, 800)
    } catch (e: any) {
      setStatusMsg("保存失败: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  const updateModel = (key: string, value: any) => {
    setConfig((c) => c ? { ...c, model: { ...c.model, [key]: value } } : c)
  }

  const updateProvider = (pName: string, field: string, value: string) => {
    setConfig((c) => {
      if (!c) return c
      const providers = { ...c.providers }
      providers[pName] = { ...providers[pName], [field]: value }
      return { ...c, providers }
    })
  }

  const toggleKey = (pName: string) => {
    setVisibleKeys((v) => ({ ...v, [pName]: !v[pName] }))
  }

  const handleActivateLicense = async () => {
    const trimmed = licenseInput.trim()
    if (!trimmed) {
      setLicenseMsg("请输入 License 内容")
      return
    }
    setActivating(true)
    setLicenseMsg("")
    try {
      const info = await api.activateLicense(trimmed)
      setLicenseInfo(info)
      setLicenseMsg("✅ License 激活成功！")
      onLicenseActivated?.()
    } catch (e: any) {
      setLicenseMsg("激活失败: " + e.message)
    } finally {
      setActivating(false)
    }
  }

  // Provider 选择项的 collection
  const providerCollection = useMemo(
    () => createListCollection({ items: Object.keys(PROVIDER_LABELS).map((k) => ({ value: k, label: PROVIDER_LABELS[k] || k })) }),
    [],
  )

  return (
    <Box display={open ? "block" : "none"}>
      {/* 遮罩 */}
      <Box
        position="fixed"
        inset={0}
        bg="blackAlpha.600"
        zIndex={100}
        onClick={onClose}
      />
      {/* 抽屉 */}
      <Box
        position="fixed"
        top={0}
        right={0}
        w="420px"
        h="100vh"
        bg="gray.900"
        borderLeft="1px solid"
        borderColor="gray.800"
        zIndex={101}
        display="flex"
        flexDirection="column"
        overflowY="auto"
        p={6}
        gap={6}
      >
        <HStack justify="space-between">
          <Text fontSize="lg" fontWeight="bold">⚙️ 设置</Text>
          <IconButton aria-label="关闭" size="sm" variant="ghost" onClick={onClose}>
            ✕
          </IconButton>
        </HStack>

        {loading && <Text color="gray.500">加载中…</Text>}
        {!config && !loading && <Text color="gray.500">加载配置失败</Text>}

        {config && (
          <>
            {/* 模型配置 */}
            <VStack align="stretch" gap={3}>
              <Text fontSize="sm" fontWeight="bold" color="gray.300">模型</Text>

              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>Provider</Text>
                <Select.Root
                  collection={providerCollection}
                  size="sm"
                  value={[config.model.provider]}
                  onValueChange={(d) => updateModel("provider", d.value[0]!)}
                >
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger bg="gray.800" border="none" color="gray.200">
                      <Select.ValueText />
                    </Select.Trigger>
                    <Select.IndicatorGroup>
                      <Select.Indicator color="gray.400" />
                    </Select.IndicatorGroup>
                  </Select.Control>
                  <Select.Positioner>
                    <Select.Content bg="gray.750" borderColor="gray.600" shadow="lg">
                      {providerCollection.items.map((item) => (
                        <Select.Item
                          key={item.value}
                          item={item}
                          color="gray.200"
                          _highlighted={{ bg: "gray.700", color: "white" }}
                          _selected={{ bg: "blue.800", color: "blue.200" }}
                        >
                          {item.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Positioner>
                </Select.Root>
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>模型名</Text>
                <Input
                  size="sm"
                  value={config.model.model}
                  onChange={(e) => updateModel("model", e.target.value)}
                  placeholder="输入模型名…"
                  bg="gray.800"
                  border="none"
                  color="gray.200"
                  _placeholder={{ color: "gray.500" }}
                />
                {(PROVIDER_MODELS[config.model.provider]?.length ?? 0) > 0 && (
                  <Wrap mt={2} gap={1.5}>
                    {PROVIDER_MODELS[config.model.provider]!.map((m) => (
                      <Box
                        key={m}
                        as="button"
                        fontSize="xs"
                        px={2} py={0.5}
                        bg={config.model.model === m ? "blue.900" : "gray.800"}
                        color={config.model.model === m ? "blue.300" : "gray.400"}
                        border="1px solid"
                        borderColor={config.model.model === m ? "blue.700" : "gray.700"}
                        borderRadius="md"
                        cursor="pointer"
                        _hover={{ bg: "gray.700", color: "gray.200" }}
                        onClick={() => updateModel("model", m)}
                      >
                        {m}
                      </Box>
                    ))}
                  </Wrap>
                )}
              </Box>

              <Box>
                <HStack justify="space-between">
                  <Text fontSize="xs" color="gray.500">Temperature</Text>
                  <Text fontSize="xs" color="gray.400">{config.model.temperature.toFixed(2)}</Text>
                </HStack>
                <Slider.Root
                  min={0} max={2} step={0.05}
                  value={[config.model.temperature]}
                  onValueChange={(d) => updateModel("temperature", d.value[0])}
                >
                  <Slider.Control>
                    <Slider.Track>
                      <Slider.Range />
                    </Slider.Track>
                    <Slider.Thumbs />
                  </Slider.Control>
                </Slider.Root>
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>Max Tokens</Text>
                <Input
                  size="sm"
                  type="number"
                  value={config.model.maxTokens}
                  onChange={(e) => updateModel("maxTokens", parseInt(e.target.value) || 4096)}
                  bg="gray.800"
                  border="none"
                />
              </Box>
            </VStack>

            {/* Provider Keys */}
            <VStack align="stretch" gap={4}>
              <Text fontSize="sm" fontWeight="bold" color="gray.300">API Keys</Text>
              {Object.entries(config.providers).map(([pName, pVal]) => {
                const hasKey = pVal.hasKey
                return (
                  <Box key={pName} bg="gray.800" p={3} borderRadius="md">
                    <HStack justify="space-between" mb={2}>
                      <HStack gap={2}>
                        <Box w="8px" h="8px" borderRadius="full" bg={pVal.hasKey ? "green.400" : "red.400"} />
                        <Text fontSize="sm" fontWeight="medium">{PROVIDER_LABELS[pName] || pName}</Text>
                      </HStack>
                      <Text fontSize="xs" color={pVal.hasKey ? "gray.500" : "red.400"}>
                        {pVal.hasKey ? "已配置" : "未配置"}
                      </Text>
                    </HStack>

                    {pName !== "ollama" && (
                      <Box mb={2}>
                        <Text fontSize="xs" color="gray.500" mb={1}>API Key</Text>
                        <HStack gap={0}>
                          <Input
                            size="sm"
                            type={visibleKeys[pName] ? "text" : "password"}
                            value={pVal.apiKey || ""}
                            onChange={(e) => updateProvider(pName, "apiKey", e.target.value)}
                            placeholder={pVal.hasKey ? "已配置（脱敏显示）" : "输入 API Key…"}
                            fontFamily="mono"
                            fontSize="xs"
                            bg="gray.750"
                            border="none"
                          />
                          <IconButton
                            aria-label="显示/隐藏"
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleKey(pName)}
                          >
                            {visibleKeys[pName] ? "🙈" : "👁️"}
                          </IconButton>
                        </HStack>
                      </Box>
                    )}

                    <Box>
                      <Text fontSize="xs" color="gray.500" mb={1}>Base URL</Text>
                      <Input
                        size="sm"
                        value={pVal.baseUrl || ""}
                        onChange={(e) => updateProvider(pName, "baseUrl", e.target.value)}
                        placeholder={pName === "ollama" ? "http://localhost:11434" : "默认"}
                        fontSize="xs"
                        bg="gray.750"
                        border="none"
                      />
                    </Box>
                  </Box>
                )
              })}
            </VStack>
          </>
        )}

        {/* License 激活 */}
        {config && (
          <>
            <Separator borderColor="gray.700" />
            <VStack align="stretch" gap={3}>
              <Text fontSize="sm" fontWeight="bold" color="gray.300">🔑 License 激活</Text>

              {/* 当前状态 */}
              {licenseInfo && (
                <Box bg="gray.800" p={3} borderRadius="md">
                  <HStack justify="space-between">
                    <Text fontSize="xs" color="gray.400">当前状态</Text>
                    <Box
                      px={2} py={0.5}
                      borderRadius="full"
                      bg={licenseInfo.licensee === "社区版" ? "gray.750" : "green.900"}
                      color={licenseInfo.licensee === "社区版" ? "gray.400" : "green.300"}
                      fontSize="xs"
                      fontWeight="bold"
                    >
                      {licenseInfo.licensee === "社区版" ? "社区版" : licenseInfo.licenseKey}
                    </Box>
                  </HStack>
                  {licenseInfo.licensee && licenseInfo.licensee !== "社区版" && (
                    <Text fontSize="xs" color="gray.500" mt={1}>被许可人: {licenseInfo.licensee}</Text>
                  )}
                  {licenseInfo.expiresAt && (
                    <Text fontSize="xs" color="gray.500">到期日: {new Date(licenseInfo.expiresAt).toLocaleDateString()}</Text>
                  )}
                </Box>
              )}

              {/* 激活输入 */}
              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  License Key / Tier 名称
                </Text>
                <Input
                  size="sm"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  placeholder="粘贴 License JSON 内容或在开发模式下输入 pro / enterprise"
                  fontFamily="mono"
                  fontSize="xs"
                  bg="gray.800"
                  border="none"
                  color="gray.200"
                  _placeholder={{ color: "gray.500" }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleActivateLicense() }}
                />
              </Box>

              {licenseMsg && (
                <Text fontSize="xs" color={licenseMsg.startsWith("❌") ? "red.400" : "green.400"}>
                  {licenseMsg}
                </Text>
              )}

              <Button
                size="sm"
                colorPalette="green"
                onClick={handleActivateLicense}
                loading={activating}
                loadingText="激活中…"
              >
                🚀 激活 License
              </Button>

              <Text fontSize="xs" color="gray.600" fontStyle="italic">
                💡 开发模式设置 <Code fontSize="xs" color="gray.500">TRY_DEV_MODE=true</Code> 后可直接输入 pro / enterprise 激活
              </Text>
            </VStack>
          </>
        )}

        {/* 订阅/等级面板 */}
        {config && (
          <>
            <Separator borderColor="gray.700" />
            <TierPanel refreshKey={quotaVersion} />
          </>
        )}

        {/* 工具 & Skill 管理 */}
        {config && (
          <>
            <Separator borderColor="gray.700" />
            <VStack align="stretch" gap={3}>
              <Text fontSize="sm" fontWeight="bold" color="gray.300">🧰 工具与技能管理</Text>
              <ToolSkillManager refreshKey={quotaVersion} />
            </VStack>
          </>
        )}

        {/* 底部按钮 */}
        <HStack justify="space-between" mt="auto" pt={4} borderTop="1px solid" borderColor="gray.800">
          {statusMsg && <Text fontSize="sm" color="gray.400" flex={1}>{statusMsg}</Text>}
          <HStack gap={2}>
            <a href="/api/docs" target="_blank" className="api-docs-link">📖 API 文档</a>
            <Button size="sm" variant="ghost" onClick={onClose}>取消</Button>
            <Button size="sm" colorPalette="blue" onClick={handleSave} loading={saving} disabled={!config}>
              保存
            </Button>
          </HStack>
        </HStack>
      </Box>
    </Box>
  )
}
