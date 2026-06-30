// src/web/src/components/ErrorBoundary.tsx
// ====================================================
// 全局错误边界 — 捕获未处理异常防止白屏
// ====================================================

import { Component, type ErrorInfo, type ReactNode } from "react"
import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.950">
          <VStack gap={4} maxW="420px" textAlign="center" p={6}>
            <Text fontSize="4xl">💥</Text>
            <Heading size="lg" color="white">出了点问题</Heading>
            <Text color="gray.400" fontSize="sm">
              {this.state.error?.message || "未知错误"}
            </Text>
            <Box
              as="pre"
              bg="gray.900"
              p={3}
              borderRadius="md"
              fontSize="xs"
              color="gray.500"
              w="100%"
              maxH="160px"
              overflow="auto"
            >
              {this.state.error?.stack?.slice(0, 500) || "无堆栈信息"}
            </Box>
            <Button colorScheme="blue" onClick={this.handleReset}>
              重试
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </VStack>
        </Box>
      )
    }

    return this.props.children
  }
}
