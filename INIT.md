构建一个单机桌面低代码ETL工具，简易版Alteryx，采用Tauri+React+TypeScript技术栈。
前端使用ReactFlow实现DAG画布拖拽、节点连线、节点配置面板，ShadCN UI做组件，Zustand管理画布状态，TanStack Table展示数据预览；后端使用Fastify，核心计算引擎基于DuckDB+Apache Arrow，DAG拓扑调度执行，SSE推送运行日志与样本预览；工作流元数据存在SQLite，中间spill缓存使用Parquet。
MVP先实现：画布拖拽保存加载DAG、Input读取CSV/Parquet、Select、Filter节点，运行时拓扑执行，返回前N行预览数据。
不要做分布式，优先单机流式，不要手写join/spill逻辑，全部交给DuckDB处理。请生成项目脚手架、目录结构，写出基础可运行代码。

第一阶段需要实现的：
支持的输入工具：CSV,Excel,SQLServer
支持的输出工具：CSV,Excel,SQLServer

支持的转换节点：Select,Filter,Join,Aggregation
支持的聚合函数：Sum,Count,Max,Min,Avg
支持的排序：Sort

操作的方式完全遵循Alteryx的拖拽DAG工作流设计：拖拽DAG、配置节点参数、运行工作流

工作流运行完成后点击任意一个阶段可以查看当前阶段缓存的数据。
