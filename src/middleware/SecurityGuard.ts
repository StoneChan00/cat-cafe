/**
 * Security Guard
 * 安全操作护栏系统
 * Phase 2 核心组件：防止 AI 直接误碰真实危险资源
 */

// ============ 类型定义 ============

/**
 * 操作风险等级
 */
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/**
 * 操作类型
 */
export type OperationType = 
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'command_exec'
  | 'network_request'
  | 'git_operation'
  | 'system_config';

/**
 * 安全检查结果
 */
export interface SecurityCheckResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  operation: OperationType;
  target: string;
  reason?: string;
  requiresConfirmation: boolean;
  suggestedAction?: string;
}

/**
 * 安全策略规则
 */
export interface SecurityRule {
  id: string;
  operation: OperationType;
  pattern: RegExp;
  riskLevel: RiskLevel;
  message: string;
  requiresConfirmation: boolean;
  suggestedAction?: string;
}

/**
 * 确认回调
 */
export type ConfirmationCallback = (result: SecurityCheckResult) => Promise<boolean>;

// ============ 默认安全规则 ============

const DEFAULT_SECURITY_RULES: SecurityRule[] = [
  // 文件操作规则
  {
    id: 'file-delete-critical',
    operation: 'file_delete',
    pattern: /\.(git|env|config|lock)$/i,
    riskLevel: 'critical',
    message: '尝试删除关键配置文件，这是高风险操作',
    requiresConfirmation: true,
    suggestedAction: '请确认是否真的需要删除此文件，建议先备份'
  },
  {
    id: 'file-delete-node-modules',
    operation: 'file_delete',
    pattern: /node_modules/,
    riskLevel: 'medium',
    message: '尝试删除 node_modules 目录',
    requiresConfirmation: false,
    suggestedAction: '建议使用 npm ci 或 npm install 重新安装'
  },
  {
    id: 'file-write-config',
    operation: 'file_write',
    pattern: /\.(json|yaml|yml|config\.js|config\.ts)$/i,
    riskLevel: 'medium',
    message: '尝试修改配置文件',
    requiresConfirmation: true,
    suggestedAction: '建议先备份原配置文件'
  },
  {
    id: 'file-write-source',
    operation: 'file_write',
    pattern: /\.(ts|js|tsx|jsx|py|go|rs)$/i,
    riskLevel: 'low',
    message: '修改源代码文件',
    requiresConfirmation: false
  },
  
  // 命令执行规则
  {
    id: 'command-rm-rf',
    operation: 'command_exec',
    pattern: /rm\s+-rf?\s+/i,
    riskLevel: 'critical',
    message: '检测到 rm -rf 命令，这是极高风险操作',
    requiresConfirmation: true,
    suggestedAction: '请确认目标路径是否正确，避免误删重要数据'
  },
  {
    id: 'command-git-force',
    operation: 'git_operation',
    pattern: /git\s+.*--force|git\s+.*-f/i,
    riskLevel: 'high',
    message: '检测到 Git 强制操作',
    requiresConfirmation: true,
    suggestedAction: '强制操作可能覆盖他人提交，请谨慎使用'
  },
  {
    id: 'command-system',
    operation: 'system_config',
    pattern: /(sudo|chmod|chown|systemctl|service)/i,
    riskLevel: 'high',
    message: '检测到系统级操作',
    requiresConfirmation: true,
    suggestedAction: '系统级操作可能影响整个环境，请确认权限和必要性'
  },
  
  // 网络请求规则
  {
    id: 'network-external',
    operation: 'network_request',
    pattern: /https?:\/\//,
    riskLevel: 'low',
    message: '外部网络请求',
    requiresConfirmation: false
  },
  {
    id: 'network-sensitive',
    operation: 'network_request',
    pattern: /(api-key|token|password|secret|credential)/i,
    riskLevel: 'high',
    message: '请求中可能包含敏感信息',
    requiresConfirmation: true,
    suggestedAction: '请确认不会泄露敏感凭证'
  }
];

// ============ 安全策略配置 ============

/**
 * 安全策略配置
 */
export interface SecurityPolicy {
  enabled: boolean;
  rules: SecurityRule[];
  autoConfirmLowRisk: boolean;
  logAllOperations: boolean;
  maxDailyHighRiskOperations: number;
}

/**
 * 默认安全策略
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  enabled: true,
  rules: DEFAULT_SECURITY_RULES,
  autoConfirmLowRisk: true,
  logAllOperations: true,
  maxDailyHighRiskOperations: 10
};

// ============ 核心函数 ============

/**
 * 检查操作安全风险
 */
export function checkOperationSecurity(
  operation: OperationType,
  target: string,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
): SecurityCheckResult {
  if (!policy.enabled) {
    return {
      allowed: true,
      riskLevel: 'safe',
      operation,
      target,
      requiresConfirmation: false
    };
  }
  
  // 查找匹配的规则
  for (const rule of policy.rules) {
    if (rule.operation !== operation) continue;
    
    if (rule.pattern.test(target)) {
      return {
        allowed: true, // 默认允许，但需要确认
        riskLevel: rule.riskLevel,
        operation,
        target,
        reason: rule.message,
        requiresConfirmation: rule.requiresConfirmation,
        suggestedAction: rule.suggestedAction
      };
    }
  }
  
  // 无匹配规则，默认为安全
  return {
    allowed: true,
    riskLevel: 'safe',
    operation,
    target,
    requiresConfirmation: false
  };
}

/**
 * 检查文件操作安全性
 */
export function checkFileOperation(
  operation: 'read' | 'write' | 'delete',
  filePath: string,
  policy?: SecurityPolicy
): SecurityCheckResult {
  const operationType: OperationType = 
    operation === 'read' ? 'file_read' :
    operation === 'write' ? 'file_write' : 'file_delete';
  
  return checkOperationSecurity(operationType, filePath, policy);
}

/**
 * 检查命令安全性
 */
export function checkCommand(
  command: string,
  policy?: SecurityPolicy
): SecurityCheckResult {
  // 判断命令类型
  let operationType: OperationType = 'command_exec';
  
  if (command.startsWith('git ')) {
    operationType = 'git_operation';
  } else if (/curl|wget|fetch/i.test(command)) {
    operationType = 'network_request';
  }
  
  return checkOperationSecurity(operationType, command, policy);
}

/**
 * 格式化安全检查报告
 */
export function formatSecurityReport(result: SecurityCheckResult): string {
  const lines: string[] = [];
  
  lines.push(`操作: ${result.operation}`);
  lines.push(`目标: ${result.target}`);
  lines.push(`风险等级: ${result.riskLevel.toUpperCase()}`);
  
  if (result.reason) {
    lines.push(`警告: ${result.reason}`);
  }
  
  if (result.requiresConfirmation) {
    lines.push('需要用户确认');
  }
  
  if (result.suggestedAction) {
    lines.push(`建议: ${result.suggestedAction}`);
  }
  
  return lines.join('\n');
}

// ============ 操作日志 ============

interface OperationLog {
  timestamp: string;
  operation: OperationType;
  target: string;
  riskLevel: RiskLevel;
  confirmed: boolean;
  userId?: string;
}

let operationLog: OperationLog[] = [];
let dailyHighRiskCount = 0;
let lastResetDate = new Date().toDateString();

/**
 * 重置每日计数
 */
function resetDailyCount(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyHighRiskCount = 0;
    lastResetDate = today;
  }
}

/**
 * 记录操作
 */
export function logOperation(
  result: SecurityCheckResult,
  confirmed: boolean,
  userId?: string
): void {
  resetDailyCount();
  
  const log: OperationLog = {
    timestamp: new Date().toISOString(),
    operation: result.operation,
    target: result.target,
    riskLevel: result.riskLevel,
    confirmed,
    userId
  };
  
  operationLog.push(log);
  
  // 限制日志大小
  if (operationLog.length > 1000) {
    operationLog = operationLog.slice(-500);
  }
  
  // 统计高风险操作
  if (result.riskLevel === 'high' || result.riskLevel === 'critical') {
    dailyHighRiskCount++;
  }
}

/**
 * 获取操作日志
 */
export function getOperationLog(
  filter?: {
    operation?: OperationType;
    riskLevel?: RiskLevel;
    since?: Date;
    limit?: number;
  }
): OperationLog[] {
  let logs = [...operationLog];
  
  if (filter?.operation) {
    logs = logs.filter(l => l.operation === filter.operation);
  }
  
  if (filter?.riskLevel) {
    logs = logs.filter(l => l.riskLevel === filter.riskLevel);
  }
  
  if (filter?.since) {
    logs = logs.filter(l => new Date(l.timestamp) >= filter.since!);
  }
  
  if (filter?.limit) {
    logs = logs.slice(-filter.limit);
  }
  
  return logs;
}

/**
 * 检查是否超过每日高风险操作限制
 */
export function isDailyHighRiskLimitReached(
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
): boolean {
  resetDailyCount();
  return dailyHighRiskCount >= policy.maxDailyHighRiskOperations;
}

// ============ SecurityGuard 类 ============

/**
 * SecurityGuard 类
 * 提供高级安全管理功能
 */
export class SecurityGuard {
  private policy: SecurityPolicy;
  private confirmationCallback?: ConfirmationCallback;
  
  constructor(
    policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
    confirmationCallback?: ConfirmationCallback
  ) {
    this.policy = policy;
    this.confirmationCallback = confirmationCallback;
  }
  
  /**
   * 检查操作
   */
  check(operation: OperationType, target: string): SecurityCheckResult {
    return checkOperationSecurity(operation, target, this.policy);
  }
  
  /**
   * 验证并执行操作
   */
  async verifyAndExecute<T>(
    operation: OperationType,
    target: string,
    executeFn: () => Promise<T>,
    userId?: string
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const check = this.check(operation, target);
    
    // 检查是否超过每日限制
    if (isDailyHighRiskLimitReached(this.policy)) {
      return {
        success: false,
        error: '今日高风险操作次数已达上限，请联系管理员'
      };
    }
    
    // 需要确认时
    if (check.requiresConfirmation) {
      let confirmed = false;
      
      if (this.confirmationCallback) {
        confirmed = await this.confirmationCallback(check);
      } else {
        // 默认拒绝需要确认的操作
        confirmed = false;
      }
      
      logOperation(check, confirmed, userId);
      
      if (!confirmed) {
        return {
          success: false,
          error: `操作被拒绝: ${check.reason || '需要确认但未获得授权'}`
        };
      }
    } else {
      logOperation(check, true, userId);
    }
    
    try {
      const result = await executeFn();
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '操作执行失败'
      };
    }
  }
  
  /**
   * 检查文件操作
   */
  checkFile(operation: 'read' | 'write' | 'delete', filePath: string): SecurityCheckResult {
    return checkFileOperation(operation, filePath, this.policy);
  }
  
  /**
   * 检查命令
   */
  checkCommand(command: string): SecurityCheckResult {
    return checkCommand(command, this.policy);
  }
  
  /**
   * 更新策略
   */
  updatePolicy(policy: Partial<SecurityPolicy>): void {
    Object.assign(this.policy, policy);
  }
  
  /**
   * 添加自定义规则
   */
  addRule(rule: SecurityRule): void {
    this.policy.rules.push(rule);
  }
  
  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    this.policy.rules = this.policy.rules.filter(r => r.id !== ruleId);
  }
  
  /**
   * 获取策略
   */
  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    totalOperations: number;
    highRiskToday: number;
    byRiskLevel: Record<RiskLevel, number>;
  } {
    const logs = getOperationLog();
    const byRiskLevel: Partial<Record<RiskLevel, number>> = {};
    
    for (const log of logs) {
      byRiskLevel[log.riskLevel] = (byRiskLevel[log.riskLevel] || 0) + 1;
    }
    
    resetDailyCount();
    
    return {
      totalOperations: logs.length,
      highRiskToday: dailyHighRiskCount,
      byRiskLevel: byRiskLevel as Record<RiskLevel, number>
    };
  }
  
  /**
   * 获取安全报告
   */
  getSecurityReport(): string {
    const stats = this.getStats();
    const logs = getOperationLog({ limit: 10 });
    
    const lines: string[] = [];
    lines.push('=== 安全操作报告 ===');
    lines.push(`总操作数: ${stats.totalOperations}`);
    lines.push(`今日高风险: ${stats.highRiskToday}`);
    lines.push('');
    lines.push('风险分布:');
    for (const [level, count] of Object.entries(stats.byRiskLevel)) {
      lines.push(`  ${level}: ${count}`);
    }
    lines.push('');
    lines.push('最近操作:');
    for (const log of logs) {
      lines.push(`  [${log.riskLevel}] ${log.operation}: ${log.target}`);
    }
    
    return lines.join('\n');
  }
}
