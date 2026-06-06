// index.ts
import { Effect } from "effect"
import { 
  Database, 
  DatabaseFileLive, 
  DatabaseMemoryLive,
  DatabaseDefaultLive
} from "../infra/database"

// ====================================================
// 1. 定义测试数据模型
// ====================================================
interface User {
  id: number
  name: string
  email: string
  age: number
  created_at: string
}

interface CreateUserInput {
  name: string
  email: string
  age: number
}

// ====================================================
// 2. 清理 + 创建表结构（每次运行从干净状态开始）
// ====================================================

const cleanupTables = Effect.gen(function*() {
  const db = yield* Database
  yield* db.run("DROP TABLE IF EXISTS posts")
  yield* db.run("DROP TABLE IF EXISTS users")
})

const createTables = Effect.gen(function*() {
  const db = yield* Database
  
  // 先清理旧数据，确保每次运行幂等
  yield* cleanupTables
  
  yield* db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  yield* db.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `)
  
  console.log("✅ 表结构创建成功")
  return { tablesCreated: true }
})

// ====================================================
// 3. CRUD 操作封装（所有操作都从 context 获取 db）
// ====================================================

// 插入用户
const insertUser = (input: CreateUserInput) =>
  Effect.gen(function*() {
    const db = yield* Database
    const changes = yield* db.run(
      "INSERT INTO users (name, email, age) VALUES (?, ?, ?)",
      [input.name, input.email, input.age]
    )
    console.log(`✅ 用户创建成功: ${input.name}`)
    return changes
  })

// 查询所有用户
const getAllUsers = Effect.gen(function*() {
  const db = yield* Database
  const users = yield* db.query<User>(
    "SELECT * FROM users ORDER BY created_at DESC"
  )
  console.log(`📊 查询到 ${users.length} 个用户`)
  return users
})

// 根据 ID 查询用户
const getUserById = (id: number) =>
  Effect.gen(function*() {
    const db = yield* Database
    const users = yield* db.query<User>(
      "SELECT * FROM users WHERE id = ?",
      [id]
    )
    const user = users[0] ?? null
    if (user) {
      console.log(`🔍 找到用户: ${user.name}`)
    } else {
      console.log(`❌ 未找到 ID 为 ${id} 的用户`)
    }
    return user
  })

// 更新用户年龄
const updateUserAge = (id: number, newAge: number) =>
  Effect.gen(function*() {
    const db = yield* Database
    const changes = yield* db.run(
      "UPDATE users SET age = ? WHERE id = ?",
      [newAge, id]
    )
    if (changes > 0) {
      console.log(`✏️ 用户 ${id} 年龄更新为 ${newAge}`)
    } else {
      console.log(`❌ 未找到用户 ${id}`)
    }
    return changes
  })

// 删除用户
const deleteUser = (id: number) =>
  Effect.gen(function*() {
    const db = yield* Database
    const changes = yield* db.run(
      "DELETE FROM users WHERE id = ?",
      [id]
    )
    if (changes > 0) {
      console.log(`🗑️ 用户 ${id} 已删除`)
    } else {
      console.log(`❌ 未找到用户 ${id}`)
    }
    return changes
  })

// 插入帖子
const insertPost = (userId: number, title: string, content: string) =>
  Effect.gen(function*() {
    const db = yield* Database
    const changes = yield* db.run(
      "INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)",
      [userId, title, content]
    )
    console.log(`📝 帖子创建成功: ${title}`)
    return changes
  })

// 查询用户的所有帖子
const getUserPosts = (userId: number) =>
  Effect.gen(function*() {
    const db = yield* Database
    const posts = yield* db.query<{ id: number; title: string; content: string; created_at: string }>(
      "SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    )
    console.log(`📄 用户 ${userId} 有 ${posts.length} 个帖子`)
    return posts
  })

// 复杂查询：用户及其帖子数量
const getUserWithPostCount = Effect.gen(function*() {
  const db = yield* Database
  const results = yield* db.query<{
    name: string
    email: string
    post_count: number
  }>(
    `SELECT 
      u.name, 
      u.email, 
      COUNT(p.id) as post_count
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
    GROUP BY u.id
    ORDER BY post_count DESC`
  )
  return results
})

// 年龄过滤查询
const getUsersByMinAge = (minAge: number) =>
  Effect.gen(function*() {
    const db = yield* Database
    const users = yield* db.query<User>(
      "SELECT * FROM users WHERE age >= ?",
      [minAge]
    )
    return users
  })

// ====================================================
// 4. 完整测试流程
// ====================================================

const testDatabase = Effect.gen(function*() {
  console.log("\n" + "=".repeat(60))
  console.log("🚀 开始数据库测试")
  console.log("=".repeat(60) + "\n")
  
  // 1. 创建表
  yield* createTables
  
  // 2. 插入用户
  console.log("\n--- 插入用户 ---")
  yield* insertUser({ name: "Alice", email: "alice@example.com", age: 25 })
  yield* insertUser({ name: "Bob", email: "bob@example.com", age: 30 })
  yield* insertUser({ name: "Charlie", email: "charlie@example.com", age: 35 })
  
  // 3. 查询所有用户
  console.log("\n--- 查询所有用户 ---")
  const allUsers = yield* getAllUsers
  console.table(allUsers)
  
  // 4. 查询单个用户
  console.log("\n--- 查询单个用户 ---")
  const alice = yield* getUserById(1)
  console.log("Alice 详情:", alice)
  
  // 5. 更新用户
  console.log("\n--- 更新用户 ---")
  yield* updateUserAge(1, 26)
  const updatedAlice = yield* getUserById(1)
  console.log("更新后的 Alice:", updatedAlice)
  
  // 6. 插入帖子
  console.log("\n--- 插入帖子 ---")
  yield* insertPost(1, "My First Post", "Hello, this is my first post!")
  yield* insertPost(1, "Second Post", "Learning bun:sqlite with Effect-TS")
  yield* insertPost(2, "Bob's Corner", "Welcome to my corner")
  
  // 7. 查询用户的帖子
  console.log("\n--- 查询用户的帖子 ---")
  const alicePosts = yield* getUserPosts(1)
  console.table(alicePosts)
  
  // 8. 复杂查询示例
  console.log("\n--- 复杂查询：用户及其帖子数量 ---")
  const userWithPostCount = yield* getUserWithPostCount
  console.table(userWithPostCount)
  
  // 9. 年龄过滤查询
  console.log("\n--- 年龄过滤（年龄 >= 30）---")
  const adults = yield* getUsersByMinAge(30)
  console.table(adults)
  
  // 10. 删除用户（级联删除帖子）
  console.log("\n--- 删除用户（级联删除）---")
  yield* deleteUser(3)  // 删除 Charlie
  const remainingUsers = yield* getAllUsers
  console.log(`剩余用户数: ${remainingUsers.length}`)
  
  // 11. 验证帖子级联删除
  console.log("\n--- 验证级联删除 ---")
  const charliePosts = yield* getUserPosts(3)
  console.log(`Charlie 的帖子数（应为 0）: ${charliePosts.length}`)
  
  console.log("\n" + "=".repeat(60))
  console.log("✅ 数据库测试完成")
  console.log("=".repeat(60) + "\n")
  
  return { success: true }
})

// ====================================================
// 5. 错误处理包装
// ====================================================

const runTest = (name: string, layer: ReturnType<typeof DatabaseFileLive>) =>
  Effect.gen(function*() {
    console.log(`\n${"🌟".repeat(30)}`)
    console.log(`🧪 测试数据库: ${name}`)
    console.log(`${"🌟".repeat(30)}`)
    
    const result = yield* testDatabase.pipe(
      Effect.provide(layer)
    )
    
    console.log(`✅ ${name} 测试通过\n`)
    return result
  })

// ====================================================
// 6. 主程序：测试两种数据库
// ====================================================

const main = Effect.gen(function*() {
  console.log("🎯 Effect-TS + bun:sqlite 数据库测试套件")
  console.log("=".repeat(60))
  
  // 测试 1: 文件数据库
  yield* runTest("文件数据库 (./try.db)", DatabaseDefaultLive)
  
  // 测试 2: 内存数据库（每次测试都是全新的）
  yield* runTest("内存数据库 (:memory:)", DatabaseMemoryLive)
  
  // 额外：自定义文件路径
  yield* runTest("自定义文件数据库 (./custom.db)", DatabaseFileLive("./custom.db"))
  
  console.log("\n" + "🎉".repeat(30))
  console.log("所有测试完成！")
  console.log("🎉".repeat(30))
})

// ====================================================
// 7. 运行程序
// ====================================================

// 运行主程序
Effect.runPromise(main).catch(error => {
  console.error("程序运行失败:", error)
  process.exit(1)
})

// 优雅关闭
process.on("SIGINT", () => {
  console.log("\n👋 收到中断信号，正在退出...")
  process.exit(0)
})