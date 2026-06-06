import { Database as BunDatabase } from "bun:sqlite"
import { Context, Effect, Layer } from "effect"

export interface DatabaseService {
    readonly query: <T = unknown>(
        sql: string,
        params?: unknown[]
    ) => Effect.Effect<T[], Error>

    readonly run: (
        sql: string,
        params?: unknown[]
    ) => Effect.Effect<number, Error>

    /** 在事务中执行多个操作，任意一步失败则回滚 */
    readonly transaction: <A, E>(
        effect: Effect.Effect<A, E, DatabaseService>
    ) => Effect.Effect<A, E | Error, DatabaseService>

    /** 获取最近一次 INSERT 的 rowid */
    readonly lastInsertId: () => Effect.Effect<number, Error>

    readonly close: () => Effect.Effect<void, Error>
}

export class Database extends Context.Tag("Database")<Database, DatabaseService>() { }

export interface SQLiteConfig {
    filename: string
}

const DEFAULT_CONFIG: SQLiteConfig = {
    filename: "./try.db"
}

export const DatabaseLive = (config: SQLiteConfig = DEFAULT_CONFIG) =>
    Layer.sync(Database, () => {
        const db = new BunDatabase(config.filename)
        db.run("PRAGMA journal_mode = WAL")
        db.run("PRAGMA foreign_keys = ON")

        // 单调递增计数器，用于事务标记
        let txCounter = 0

        const query = <T>(sql: string, params?: unknown[]) =>
            Effect.try({
                try: () => {
                    const stmt = db.prepare(sql)
                    if (params && params.length > 0) {
                        return stmt.all(...params as any[]) as T[]
                    }
                    return stmt.all() as T[]
                },
                catch: (error) => new Error(`Failed to execute query: ${sql}, error: ${error}`)
            })

        const run = (sql: string, params?: unknown[]) =>
            Effect.try({
                try: () => {
                    if (params && params.length > 0) {
                        return db.run(sql, ...params as any[]).changes
                    }
                    return db.run(sql).changes
                },
                catch: (error) => new Error(`Failed to execute run: ${sql}, error: ${error}`)
            })

        const lastInsertId = () =>
            Effect.try({
                try: () => {
                    const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number }
                    return row.id
                },
                catch: (error) => new Error(`Failed to get last insert id, error: ${error}`)
            })

        // 使用 SAVEPOINT 实现嵌套事务
        const transaction = <A, E>(
            effect: Effect.Effect<A, E, DatabaseService>
        ): Effect.Effect<A, E | Error, DatabaseService> => {
            const savepoint = `_tx${txCounter++}`
            
            return Effect.gen(function* () {
                yield* run(`SAVEPOINT ${savepoint}`)
                
                const result = yield* Effect.exit(effect)
                
                if (result._tag === "Failure") {
                    yield* run(`ROLLBACK TO SAVEPOINT ${savepoint}`)
                    return yield* Effect.failCause(result.cause) as Effect.Effect<A, E | Error>
                }
                
                yield* run(`RELEASE SAVEPOINT ${savepoint}`)
                return result.value as A
            })
        }

        return {
            query,
            run,
            transaction,
            lastInsertId,
            close: () => Effect.try({
                try: () => db.close(),
                catch: (error) => new Error(`Failed to close database, error: ${error}`)
            })
        }
    })

export const DatabaseFileLive = (filename: string) => DatabaseLive({ filename })
export const DatabaseMemoryLive = DatabaseFileLive(":memory:")
export const DatabaseDefaultLive = DatabaseFileLive(DEFAULT_CONFIG.filename)
