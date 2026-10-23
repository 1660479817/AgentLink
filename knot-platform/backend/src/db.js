import pg from "pg";

let pool;

export function getPool(databaseUrl) {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });
    // 空闲连接被对端断掉（数据库重启、网络抖动、连接数重置）时，pg 会在池上抛
    // error 事件。没有监听者时 Node 会把它升成未捕获异常，直接带走整个进程——
    // 表现是「数据库重启一次，Backend 就没了」，而这一路上没有任何代码出错。
    //
    // 这里只记录：坏连接已经被 pg 从池里摘掉，下一个请求会新建一条。
    // 不在这里重连也不退出，退出的判断交给真正的启动失败路径。
    pool.on("error", (error) => {
      console.error(`[db] idle client error: ${error?.message || error}`);
    });
  }
  return pool;
}
