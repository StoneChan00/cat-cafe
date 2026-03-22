"use strict";
/**
 * Thread 存储
 * 负责管理 thread 的持久化和状态
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreadStore = void 0;
exports.createThread = createThread;
exports.saveThread = saveThread;
exports.loadThread = loadThread;
exports.addMessage = addMessage;
exports.updateThreadStatus = updateThreadStatus;
exports.addToWorklist = addToWorklist;
exports.getNextWorkItem = getNextWorkItem;
exports.removeWorkItem = removeWorkItem;
exports.clearWorklist = clearWorklist;
exports.getPublicMessages = getPublicMessages;
exports.getContextSummary = getContextSummary;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = require("path");
// 获取数据目录
function getDataDir() {
    return process.env.CAT_CAFE_DATA_DIR || (0, path_1.join)(process.cwd(), '.cat-cafe-data');
}
function getThreadsDir() {
    return (0, path_1.join)(getDataDir(), 'threads');
}
/**
 * 创建新的 Thread
 */
async function createThread() {
    const threadId = (0, crypto_1.randomUUID)();
    const now = new Date().toISOString();
    const thread = {
        threadId,
        messages: [],
        worklist: [],
        status: 'idle',
        createdAt: now,
        updatedAt: now
    };
    await saveThread(thread);
    return thread;
}
/**
 * 保存 Thread
 */
async function saveThread(thread) {
    await (0, promises_1.mkdir)(getThreadsDir(), { recursive: true });
    const filePath = (0, path_1.join)(getThreadsDir(), `${thread.threadId}.json`);
    await (0, promises_1.writeFile)(filePath, JSON.stringify(thread, null, 2), 'utf-8');
}
/**
 * 加载 Thread
 */
async function loadThread(threadId) {
    try {
        const filePath = (0, path_1.join)(getThreadsDir(), `${threadId}.json`);
        const content = await (0, promises_1.readFile)(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * 添加消息到 Thread
 */
function addMessage(thread, message) {
    const newMessage = {
        ...message,
        id: (0, crypto_1.randomUUID)(),
        timestamp: new Date().toISOString()
    };
    thread.messages.push(newMessage);
    thread.updatedAt = new Date().toISOString();
    return newMessage;
}
/**
 * 更新 Thread 状态
 */
function updateThreadStatus(thread, status) {
    thread.status = status;
    thread.updatedAt = new Date().toISOString();
}
/**
 * 添加工作项到 Worklist
 */
function addToWorklist(thread, item) {
    thread.worklist.push({
        ...item,
        addedAt: new Date().toISOString()
    });
    thread.updatedAt = new Date().toISOString();
}
/**
 * 获取下一个工作项
 */
function getNextWorkItem(thread) {
    return thread.worklist.length > 0 ? thread.worklist[0] : null;
}
/**
 * 移除工作项
 */
function removeWorkItem(thread) {
    return thread.worklist.shift() || null;
}
/**
 * 清空 Worklist
 */
function clearWorklist(thread) {
    thread.worklist = [];
    thread.updatedAt = new Date().toISOString();
}
/**
 * 获取 Thread 公开消息
 */
function getPublicMessages(thread) {
    return thread.messages.filter(m => m.isPublic);
}
/**
 * 获取 Thread 上下文摘要（用于 MCP get_context）
 */
function getContextSummary(thread) {
    return {
        threadId: thread.threadId,
        messageCount: thread.messages.length,
        publicMessages: getPublicMessages(thread),
        currentStatus: thread.status,
        pendingWork: thread.worklist.length
    };
}
/**
 * ThreadStore 类
 * 提供更完整的 Thread 管理功能
 */
class ThreadStore {
    threads = new Map();
    /**
     * 创建新 Thread
     */
    async create() {
        const thread = await createThread();
        this.threads.set(thread.threadId, thread);
        return thread;
    }
    /**
     * 获取 Thread
     */
    async get(threadId) {
        let thread = this.threads.get(threadId) ?? null;
        if (!thread) {
            thread = await loadThread(threadId);
            if (thread) {
                this.threads.set(threadId, thread);
            }
        }
        return thread;
    }
    /**
     * 保存 Thread
     */
    async save(thread) {
        this.threads.set(thread.threadId, thread);
        await saveThread(thread);
    }
    /**
     * 添加消息
     */
    async addMessage(threadId, message) {
        const thread = await this.get(threadId);
        if (!thread)
            return null;
        const newMessage = addMessage(thread, message);
        await this.save(thread);
        return newMessage;
    }
    /**
     * 更新状态
     */
    async updateStatus(threadId, status) {
        const thread = await this.get(threadId);
        if (!thread)
            return false;
        updateThreadStatus(thread, status);
        await this.save(thread);
        return true;
    }
    /**
     * 获取上下文摘要
     */
    async getContextSummary(threadId) {
        const thread = await this.get(threadId);
        if (!thread)
            return undefined;
        return getContextSummary(thread);
    }
}
exports.ThreadStore = ThreadStore;
//# sourceMappingURL=ThreadStore.js.map