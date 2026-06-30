import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { AuthProvider } from "./AuthContext"
import { App } from "./App"
import { ToastProvider } from "./components/Toast"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChakraProvider value={defaultSystem}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </ChakraProvider>
  </StrictMode>
)
