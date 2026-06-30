// src/web/src/components/ChatBubble.tsx
// ====================================================
// 聊天气泡 + Markdown + 工具卡片
// ====================================================

import { memo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Box, Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react"
import type { ChatMessage } from "../types"
import { formatTime } from "../utils"

interface ChatBubbleProps {
  msg: ChatMessage
  isStreaming?: boolean
  onEdit?: () => void
  onCopy?: () => void
  onRegenerate?: () => void
}

/** 工具调用卡片 */
function ToolCard({ name, args, result }: { name: string; args: string; result: string | null }) {
  const [expanded, setExpanded] = useState(false)

  const preview = args.length > 120 ? args.slice(0, 120) + "…" : args

  return (
    <Box
      bg="gray.800"
      border="1px solid"
      borderColor="gray.700"
      borderRadius="md"
      my={2}
      overflow="hidden"
    >
      <HStack
        px={3} py={2}
        cursor="pointer"
        justify="space-between"
        onClick={() => setExpanded(!expanded)}
        _hover={{ bg: "gray.750" }}
      >
        <HStack gap={2}>
          <Text fontSize="xs" color="cyan.400">🔧 {name}</Text>
          {!expanded && (
            <Text fontSize="xs" color="gray.500" truncate maxW="300px">
              {preview}
            </Text>
          )}
        </HStack>
        <Text fontSize="xs" color="gray.500">{expanded ? "▼" : "▶"}</Text>
      </HStack>
      {expanded && (
        <Box px={3} pb={2} fontFamily="mono" fontSize="xs" color="gray.300" maxH="200px" overflowY="auto">
          <Text color="gray.500" mb={1}>参数:</Text>
          <Box as="pre" whiteSpace="pre-wrap" mb={2}>{args}</Box>
          {result && (
            <>
              <Text color="gray.500" mb={1}>结果:</Text>
              <Box as="pre" whiteSpace="pre-wrap" color={result.startsWith("Error") ? "red.300" : "green.300"}>
                {result.length > 2000 ? result.slice(0, 2000) + "\n…(截断)" : result}
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  )
}

export const ChatBubble = memo(function ChatBubble({
  msg,
  isStreaming,
  onEdit,
  onCopy,
  onRegenerate,
}: ChatBubbleProps) {
  const isUser = msg.role === "user"
  const isTool = msg.role === "tool"
  const showActions = !isStreaming && (isUser || msg.role === "assistant")

  // 工具调用卡片
  if (isTool) {
    const toolName = msg.name || msg.toolName || msg.metadata?.tool || "工具"
    return (
      <Box pl={12} pr={4}>
        <ToolCard name={toolName} args={msg.content || ""} result={msg.result || null} />
      </Box>
    )
  }

  return (
    <Box
      px={4} py={3}
      style={!isStreaming ? { animation: "messageIn 0.3s ease" } : undefined}
    >
      <HStack align="start" gap={3}>
        {/* Avatar */}
        <Box
          w="32px" h="32px"
          borderRadius="md"
          bg={isUser ? "gray.700" : "blue.700"}
          display="flex"
          alignItems="center"
          justifyContent="center"
          fontSize="sm"
          flexShrink={0}
        >
          {isUser ? "👤" : "🤖"}
        </Box>

        {/* Content */}
        <Box flex={1} minW={0}>
          <HStack mb={1} gap={2}>
            <Text fontSize="xs" fontWeight="bold" color={isUser ? "gray.400" : "blue.300"}>
              {isUser ? "你" : "Assistant"}
            </Text>
            {msg.timestamp && (
              <Text fontSize="xs" color="gray.600">{formatTime(msg.timestamp)}</Text>
            )}
            {isStreaming && (
              <Text fontSize="xs" color="yellow.400">
                输出中<span style={{ animation: "blink 1s step-end infinite" }}>▍</span>
              </Text>
            )}
          </HStack>

          {/* Markdown 渲染 */}
          {isUser ? (
            <Box color="gray.100" whiteSpace="pre-wrap" fontSize="sm" lineHeight="1.7">
              {msg.content}
            </Box>
          ) : (
            <Box
              className="markdown-body"
              color="gray.200"
              fontSize="sm"
              lineHeight="1.7"
              css={{
                "& pre": { bg: "gray.900", borderRadius: "md", p: 3, overflowX: "auto" },
                "& code": { fontFamily: "mono", fontSize: "0.85em" },
                "& p": { mb: 2 },
                "& ul, & ol": { pl: 4, mb: 2 },
                "& table": { w: "100%", borderCollapse: "collapse", mb: 2 },
                "& th, & td": { border: "1px solid", borderColor: "gray.700", px: 2, py: 1, fontSize: "xs" },
                "& th": { bg: "gray.800" },
                "& blockquote": {
                  borderLeft: "3px solid",
                  borderColor: "gray.600",
                  pl: 3,
                  color: "gray.400",
                  my: 2,
                },
                "& a": { color: "cyan.400" },
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "")
                    const codeStr = String(children).replace(/\n$/, "")
                    // @ts-expect-error - react-markdown types
                    const isInline = props.inline ?? false
                    if (isInline) {
                      return (
                        <Box as="code" bg="gray.800" px={1} borderRadius="sm" fontSize="0.85em">
                          {children}
                        </Box>
                      )
                    }
                    return (
                      <Box borderRadius="md" overflow="hidden" my={2}>
                        <HStack
                          bg="gray.850"
                          px={3} py={1}
                          justify="space-between"
                        >
                          <Text fontSize="xs" color="gray.400">
                            {match?.[1] || "code"}
                          </Text>
                          <CopyButton text={codeStr} />
                        </HStack>
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match?.[1] || "text"}
                          PreTag="div"
                          customStyle={{ margin: 0, borderRadius: 0 }}
                        >
                          {codeStr}
                        </SyntaxHighlighter>
                      </Box>
                    )
                  },
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </Box>
          )}

          {/* Actions */}
          {showActions && (
            <HStack mt={2} gap={1}>
              {isUser && onEdit && (
                <Button size="xs" variant="ghost" color="gray.500" onClick={onEdit}>
                  ✏️ 编辑
                </Button>
              )}
              {!isUser && onCopy && (
                <Button size="xs" variant="ghost" color="gray.500" onClick={onCopy}>
                  📋 复制
                </Button>
              )}
              {!isUser && onRegenerate && (
                <Button size="xs" variant="ghost" color="gray.500" onClick={onRegenerate}>
                  🔄 重新生成
                </Button>
              )}
            </HStack>
          )}
        </Box>
      </HStack>
    </Box>
  )
})

/** 代码块复制按钮 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs"
      variant="ghost"
      color="gray.400"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? "✓" : "📋"}
    </Button>
  )
}
