// src/web/src/components/ModelSelectorBar.tsx
// ====================================================
// 发送框下方的紧凑模型选择器
// ====================================================

import { useEffect, useMemo, useState } from "react"
import {
  Box, HStack, Input, Select, Slider, Text, VStack, Wrap,
  createListCollection, IconButton,
} from "@chakra-ui/react"
import type { AppConfig, ProviderName } from "../types"
import * as api from "../api"

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
  ollama: "Ollama",
}

export function ModelSelectorBar() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    api.fetchConfig().then(setConfig).catch(() => {})
  }, [])

  const updateModel = (key: string, value: any) => {
    setConfig((c) => {
      if (!c) return c
      const updated = { ...c, model: { ...c.model, [key]: value } }
      api.saveConfig(updated).catch(() => {})
      return updated
    })
  }

  const providerCollection = useMemo(
    () => createListCollection({
      items: Object.keys(PROVIDER_LABELS).map((k) => ({ value: k, label: PROVIDER_LABELS[k] || k }))
    }),
    [],
  )

  if (!config) return null

  const { model } = config
  const providerLabel = PROVIDER_LABELS[model.provider] || model.provider
  const quickModels = PROVIDER_MODELS[model.provider] ?? []

  return (
    <Box px={4} pb={2} bg="gray.950">
      {/* 折叠态：一行显示当前模型 */}
      <HStack
        gap={2}
        cursor="pointer"
        onClick={() => setExpanded((v) => !v)}
        py="4px"
        px={2}
        borderRadius="md"
        _hover={{ bg: "gray.900" }}
        justify="space-between"
      >
        <HStack gap={2}>
          <Text fontSize="xs" color="gray.500">
            {providerLabel}
          </Text>
          <Text fontSize="xs" color="gray.400" fontWeight="medium">
            {model.model}
          </Text>
          <Text fontSize="xs" color="gray.600">
            t={model.temperature.toFixed(2)}
          </Text>
        </HStack>
        <Text fontSize="xs" color="gray.600" transform={expanded ? "rotate(180deg)" : "none"} transition="transform 0.2s">
          ▾
        </Text>
      </HStack>

      {/* 展开态：完整模型设置 */}
      {expanded && (
        <VStack
          align="stretch"
          gap={2}
          p={2}
          bg="gray.900"
          borderRadius="md"
          border="1px solid"
          borderColor="gray.800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Provider */}
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>Provider</Text>
            <Select.Root
              collection={providerCollection}
              size="xs"
              value={[model.provider]}
              onValueChange={(d) => updateModel("provider", d.value[0]!)}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger bg="gray.800" border="none" color="gray.200" fontSize="xs">
                  <Select.ValueText />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator color="gray.400" />
                </Select.IndicatorGroup>
              </Select.Control>
              <Select.Positioner>
                <Select.Content bg="gray.700" borderColor="gray.600" shadow="dark-lg">
                  {providerCollection.items.map((item) => (
                    <Select.Item
                      key={item.value}
                      item={item}
                      color="gray.100"
                      fontSize="xs"
                      _highlighted={{ bg: "gray.600", color: "white" }}
                      _selected={{ bg: "blue.700", color: "blue.100" }}
                    >
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Positioner>
            </Select.Root>
          </Box>

          {/* 模型名 + 快捷选择 */}
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>模型</Text>
            <Input
              size="xs"
              value={model.model}
              onChange={(e) => updateModel("model", e.target.value)}
              placeholder="输入模型名…"
              bg="gray.800"
              border="none"
              color="gray.200"
              fontSize="xs"
              _placeholder={{ color: "gray.500" }}
            />
            {quickModels.length > 0 && (
              <Wrap mt={1.5} gap={1}>
                {quickModels.map((m) => (
                  <Box
                    key={m}
                    as="button"
                    fontSize="xs"
                    px={1.5} py={0.5}
                    bg={model.model === m ? "blue.900" : "gray.800"}
                    color={model.model === m ? "blue.300" : "gray.400"}
                    border="1px solid"
                    borderColor={model.model === m ? "blue.700" : "gray.700"}
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

          {/* Temperature */}
          <Box>
            <HStack justify="space-between">
              <Text fontSize="xs" color="gray.500">Temperature</Text>
              <Text fontSize="xs" color="gray.400">{model.temperature.toFixed(2)}</Text>
            </HStack>
            <Slider.Root
              min={0} max={2} step={0.05}
              value={[model.temperature]}
              onValueChange={(d) => updateModel("temperature", d.value[0])}
              size="sm"
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumbs />
              </Slider.Control>
            </Slider.Root>
          </Box>
        </VStack>
      )}
    </Box>
  )
}
