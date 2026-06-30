// src/web/src/components/LoginPage.tsx
// ====================================================
// 登录 / 注册页面
// ====================================================

import { useState } from "react"
import { Box, Button, Heading, Input, Text, VStack, HStack, Link } from "@chakra-ui/react"
import { useAuth } from "../AuthContext"

export function LoginPage() {
  const { login, register } = useAuth()

  const [mode, setMode] = useState<"login" | "register">("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setError("")
    if (!email || !password) {
      setError("请填写邮箱和密码")
      return
    }
    if (mode === "register" && !name.trim()) {
      setError("请填写用户名")
      return
    }
    setSubmitting(true)
    try {
      if (mode === "login") {
        await login(email, password)
      } else {
        await register(name.trim(), email, password)
      }
    } catch (e: any) {
      setError(e.message || "操作失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box
      w="100vw" h="100vh"
      display="flex" alignItems="center" justifyContent="center"
      bg="gray.950"
    >
      <VStack
        as="form"
        gap={4}
        w="100%" maxW="400px"
        p={8}
        bg="gray.900"
        borderRadius="xl"
        border="1px solid"
        borderColor="gray.800"
        onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
      >
        <Heading size="2xl" color="white" letterSpacing="tight">
          Try
        </Heading>
        <Text color="gray.400" fontSize="sm">
          AI 驱动的编程助手
        </Text>

        <VStack gap={3} w="100%" mt={2}>
          {mode === "register" && (
            <Input
              placeholder="用户名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              bg="gray.800" border="none" color="white"
              size="lg"
              _placeholder={{ color: "gray.500" }}
              autoFocus
            />
          )}
          <Input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            bg="gray.800" border="none" color="white"
            size="lg"
            _placeholder={{ color: "gray.500" }}
            autoFocus={mode === "login"}
          />
          <Input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            bg="gray.800" border="none" color="white"
            size="lg"
            _placeholder={{ color: "gray.500" }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />

          {error && (
            <Text color="red.400" fontSize="sm" w="100%">
              {error}
            </Text>
          )}

          <Button
            w="100%"
            size="lg"
            colorScheme="blue"
            loading={submitting}
            type="submit"
          >
            {mode === "login" ? "登录" : "注册"}
          </Button>
        </VStack>

        <HStack gap={1} fontSize="sm" color="gray.400">
          <Text>
            {mode === "login" ? "没有账号？" : "已有账号？"}
          </Text>
          <Link
            color="blue.400"
            cursor="pointer"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError("") }}
          >
            {mode === "login" ? "立即注册" : "去登录"}
          </Link>
        </HStack>
      </VStack>
    </Box>
  )
}
