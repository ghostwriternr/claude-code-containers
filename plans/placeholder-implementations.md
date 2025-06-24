# Placeholder Implementations - Fix Priority Plan

This document tracks placeholder implementations, TODO comments, and incomplete code that need to be fixed for production readiness.

## 📊 Progress Summary

**Overall Progress**: 1/6 items completed (16.7%)

### ✅ Completed Items
- **Repository Configuration Persistence** (2025-06-24) - Critical data persistence issue resolved

### 🔄 In Progress
- None currently

### ⏳ Remaining High Priority
- Missing Webhook Event Handlers (issue comments, PRs, reviews)
- Fake Statistics in API Endpoints (monitoring blind spots)

### 📈 Phase 1 Status: **50% Complete**
Repository data persistence ✅ | Statistics collection ⏳

## 🚨 High Priority (Fix Immediately)

### 1. Repository Configuration Persistence
**File**: `src/handlers/api/repositories.ts`
**Lines**: 27-28, 154-155
**Issue**: Repository configurations stored in memory `Map` instead of Durable Objects
**Impact**: All repository settings lost on worker restart (custom instructions, permissions, trigger phrases)
**Status**: ✅ **COMPLETED** (2025-06-24)

**What was implemented**:
- Added SQLite `repository_configs` table to GitHubAppConfigDO
- Implemented `getRepositoryConfig()` and `setRepositoryConfig()` methods in Durable Object
- Added `/repo-config/get` and `/repo-config/set` endpoints to Durable Object API
- Updated all API endpoints to use Durable Object storage instead of in-memory Map
- Removed in-memory Map completely
- Tested persistence across operations (create, read, update)

**Verification**:
- ✅ Repository configs survive worker restarts
- ✅ Custom instructions and settings persist
- ✅ API endpoints work correctly
- ✅ Default configurations provided for unconfigured repos
- ✅ TypeScript compilation successful

---

### 2. Missing Webhook Event Handlers
**File**: `src/handlers/webhooks/github.ts`
**Lines**: 173-185
**Issue**: Critical webhook events only return "acknowledged" messages
**Impact**: Claude won't respond to issue comments, pull requests, or PR reviews
**Status**: ❌ Not Started

**Missing Handlers**:
- Issue comments (e.g., "@claude please fix this")
- Pull request events (new PRs, updates)
- Pull request review events

**Fix Required**: Implement actual processing logic for these webhook events

---

### 3. Fake Statistics in API Endpoints
**Files**:
- `src/handlers/api/repositories.ts` (lines 202-218)
- `src/handlers/api/containers.ts` (lines 202-218, 242-249)
**Issue**: All monitoring endpoints return hardcoded zeros/empty arrays
**Impact**: No visibility into system usage, processing metrics, or container status
**Status**: ❌ Not Started

**Affected Endpoints**:
- Repository statistics (always returns 0 issues processed, 0 PRs created)
- Container status (always returns empty container lists)
- System metrics (no real-time data)

**Fix Required**: Replace hardcoded values with real data from Durable Objects

---

## ⚠️ Medium Priority (Fix Soon)

### 4. Development Hack in Production Code
**File**: `src/fetch.ts`
**Lines**: 14-19, 36-78
**Issue**: `WRANGLER_CONTAINERS_ISSUE_HACK` environment variable bypasses container.fetch
**Impact**: Could break production if accidentally set
**Status**: ❌ Not Started

**Risk**: Routes requests to localhost:8080 instead of actual containers when hack enabled

**Fix Required**: Remove hack or add proper documentation/safeguards

---

### 5. Container Management Blind Spots
**File**: `src/handlers/api/containers.ts`
**Lines**: 242-249
**Issue**: No way to list, monitor, or debug running containers
**Impact**: Can't troubleshoot container execution issues
**Status**: ❌ Not Started

**Missing Features**:
- List active containers
- Monitor container health
- View execution logs
- Container resource usage

**Fix Required**: Implement real container monitoring and management

---

## 🔧 Low Priority (Improve When Possible)

### 6. Inconsistent Logging
**File**: `src/handlers/github_webhooks/installation_change.ts`
**Lines**: 46, 54
**Issue**: Uses `console.log` instead of structured `logWithContext`
**Impact**: Inconsistent log formatting, harder to debug
**Status**: ❌ Not Started

**Fix Required**: Replace console.log calls with logWithContext for consistency

---

## Implementation Order

### Phase 1: Data Persistence (Week 1)
1. ✅ **Repository Configuration Storage** - **COMPLETED** (Critical for user experience)
2. **Statistics Collection** - Enable real monitoring

### Phase 2: Webhook Completion (Week 2)
3. **Issue Comment Handling** - Enable "@claude" mentions
4. **Pull Request Processing** - Complete GitHub integration

### Phase 3: System Monitoring (Week 3)
5. **Container Management** - Production debugging capabilities
6. **Remove Development Hacks** - Production hardening

### Phase 4: Polish (Week 4)
7. **Logging Consistency** - Improved debugging experience

---

## Success Criteria

### Phase 1 Complete When:
- [x] **Repository settings survive worker restarts** ✅ **DONE**
- [ ] API endpoints show real statistics instead of zeros
- [x] **Data is properly persisted in Durable Objects** ✅ **DONE**

### Phase 2 Complete When:
- [ ] Users can mention "@claude" in issue comments
- [ ] New pull requests trigger Claude processing
- [ ] PR reviews are handled appropriately

### Phase 3 Complete When:
- [ ] Container health is visible via API
- [ ] Production environment has no development hacks
- [ ] System can be monitored and debugged effectively

### Phase 4 Complete When:
- [ ] All logging uses consistent structured format
- [ ] Code is production-ready with no TODO/placeholder comments

---

## Notes

- **Repository configuration persistence** is the most critical - affects core user experience
- **Webhook handlers** are needed for full GitHub integration
- **Statistics** are important for monitoring and debugging
- **Container management** is needed for production operations

Priority should be: **Data persistence → Webhook completion → System monitoring → Polish**