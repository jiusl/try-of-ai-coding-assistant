// src/web/src/components/AgentSelector.tsx
// ====================================================
// Agent 选择器组件
// ====================================================

import { HStack, Select, Text, createListCollection } from "@chakra-ui/react"
import { useMemo } from "react"
import type { AgentInfo } from "../types"

interface AgentSelectorProps {
  agents: AgentInfo[]
  currentAgentId: string
  onChange: (agentId: string) => void
  disabled?: boolean
}

export function AgentSelector({ agents, currentAgentId, onChange, disabled }: AgentSelectorProps) {
  const collection = useMemo(
    () => createListCollection({ items: agents.map(a => ({ value: a.id, label: a.name })) }),
    [agents]
  )

  if (agents.length === 0) {
    return (
      <Text fontSize="xs" color="gray.500">加载中…</Text>
    )
  }

  return (
    <HStack gap={2}>
      <Text fontSize="xs" color="gray.500" fontWeight="medium" whiteSpace="nowrap">
        Agent
      </Text>
      <Select.Root
        collection={collection}
        size="xs"
        width="180px"
        value={[currentAgentId]}
        disabled={disabled}
        onValueChange={(d) => onChange(d.value[0]!)}
      >
        <Select.HiddenSelect />
        <Select.Control>
          <Select.Trigger bg="gray.800" border="none" color="gray.200" _hover={{ bg: "gray.700" }}>
            <Select.ValueText />
          </Select.Trigger>
          <Select.IndicatorGroup>
            <Select.Indicator color="gray.400" />
          </Select.IndicatorGroup>
        </Select.Control>
        <Select.Positioner>
          <Select.Content minW="240px" bg="gray.800" borderColor="gray.600" shadow="lg">
            {agents.map((agent) => (
              <Select.Item
                key={agent.id}
                item={{ value: agent.id, label: agent.name }}
                color="gray.200"
                _highlighted={{ bg: "gray.700", color: "white" }}
                _selected={{ bg: "blue.800", color: "blue.200" }}
              >
                <Text fontSize="sm" fontWeight="medium">{agent.name}</Text>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Select.Root>
    </HStack>
  )
}
