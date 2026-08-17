# Integration Plan: Hermes as Browser Agent for KORE-OS-TEP

## Executive Summary
This plan outlines integrating Hermes as the browser automation solution for the KORE-OS-TEP system. The recommended approach is to run Hermes as an MCP server that exposes its browser automation tools, allowing KORE-OS-TEP to call them via the existing MCP client infrastructure. This maintains architectural independence while providing access to Hermes' superior browser capabilities (multiple backends, security features, session isolation, etc.).

## Current State
- **KORE-OS-TEP**: TypeScript/Node.js MCP server with Playwright-based browser automation (`browser_automator.ts`)
- **Hermes**: Python-based agent framework with sophisticated browser automation via `agent-browser` CLI supporting local Chromium, Browserbase, Browser Use, Firecrawl, and Camofox backends

## Integration Approach: Hermes MCP Server Client
KORE-OS-TEP will:
1. Start Hermes MCP server (`hermes-tools`) as a subprocess when needed
2. Connect to it as an MCP client using `@modelcontextprotocol/sdk`
3. Call Hermes browser tools (`browser_navigate`, `browser_snapshot`, `browser_click`, etc.) via MCP
4. Fall back to existing Playwright implementation if Hermes is unavailable

This approach:
- Leverages existing MCP infrastructure in both systems
- Provides clean process separation
- Allows KORE-OS-TEP to use Hermes browser tool to delegate to Hermes
- Enables gradual migration (hybrid approach possible)
- Preserves KORE-OS-TEP's existing tool interface

## Detailed Implementation Plan

### Phase 1: Architecture & Foundation (Weeks 1-2)
**Goal**: Establish MCP client connection to Hermes and basic browser tool delegation

#### Tasks:
1. **Create Hermes MCP Client Wrapper** (`src/utils/hermes-mcp-client.ts`)
   - Spawn `hermes` subprocess with `mcp serve --tools hermes-tools` args
   - Initialize MCP client connection via stdio transport
   - Handle connection lifecycle (start/stop/restart)
   - Implement health checks and reconnection logic
   - **Test**: Verify client can connect/disconnect successfully

2. **Implement Browser Tool Delegation** (`src/tools/browser-automator.ts` modification)
   - Modify `BrowserAutomator` class to attempt Hermes MCP first
   - Fall back to existing Playwright implementation on failure
   - Map KORE-OS-TEP browser tool parameters to Hermes equivalents
   - Convert Hermes JSON responses to KORE-OS-TEP format
   - **Test**: Basic navigation works via Hermes when available

3. **Create Configuration & Constants**
   - Add `hermes.enabled` config flag to KORE-OS-TEP
   - Define Hermes MCP server args and environment
   - Set up logging and error handling
   - **Test**: Configuration toggles Hermes integration on/off

#### Deliverables:
- Working Hermes MCP client in KORE-OS-TEP
- Modified `browser_automator.ts` with MCP delegation
- Configuration for enabling/disabling Hermes
- Basic end-to-end test: navigate → snapshot → return content

### Phase 2: Full Browser Tool Support (Weeks 3-4)
**Goal**: Complete implementation of all Hermes browser capabilities with robust error handling

#### Tasks:
1. **Implement All Browser Tools via MCP**
   - `browser_navigate` (navigation)
   - `browser_snapshot` (accessibility tree snapshot)
   - `browser_click` (element interaction)
   - `browser_type` (text input)
   - `browser_press` (keyboard presses)
   - `browser_scroll` (scrolling)
   - `browser_back` (navigation back)
   - `browser_get_images` (extract image URLs)
   - `browser_console` (execute JavaScript)
   - `browser_vision` (screenshot analysis with vision model)
   - **Test**: Each tool works independently via MCP

2. **Enhanced Error Handling & Fallback**
   - Detect Hermes MCP server failures
   - Graceful fallback to Playwright implementation
   - Clear error messages when both systems fail
   - Automatic restart of failed Hermes MCP server
   - **Test**: System works when Hermes is unavailable (fallback)

3. **Session Management & Isolation**
   - Map KORE-OS-TEP session/profile concept to Hermes task_id
   - Implement proper session isolation for browser contexts
   - Handle concurrent browser operations safely
   - **Test**: Multiple isolated browser sessions work correctly

4. **Security Feature Integration**
   - Leverage Hermes' SSRF protection, credential stripping
   - Implement URL safety checking via Hermes' safeguards
   - Respect Hermes' website policy controls
   - **Test**: Security protections block malicious URLs appropriately

#### Deliverables:
- Full suite of Hermes browser tools accessible via MCP
- Robust error handling with automatic fallback
- Proper session isolation for concurrent operations
- Integrated security features from Hermes
- Comprehensive test suite covering all browser tools

### Phase 3: Advanced Features & Optimization (Weeks 5-6)
**Goal**: Implement advanced Hermes capabilities and optimize performance

#### Tasks:
1. **Context-Aware Content Extraction**
   - Utilize Hermes' `user_task` parameter in `browser_snapshot`
   - Implement task-aware summarization for large pages
   - Leverage Hermes' auxiliary models for content extraction
   - **Test**: Large page snapshots are properly summarized based on task

2. **Vision Capabilities Integration**
   - Expose Hermes' `browser_vision` and `vision_analyze` tools
   - Enable screenshot analysis via vision models
   - Integrate with KORE-OS-TEP's existing vision/text processing
   - **Test**: Visual content can be analyzed and described

3. **Performance Optimization**
   - Connection pooling for Hermes MCP connections
   - Caching of frequently accessed browser sessions
   - Lazy initialization of Hermes MCP server
   - Resource cleanup on mission completion
   - **Test**: Performance benchmarks show acceptable overhead

4. **Configuration & Tuning**
   - Expose Hermes browser config options in KORE-OS-TEP
   - Allow selection of browser backend (local/Browserbase/etc.)
   - Configure timeouts, stealth features, proxy usage
   - **Test**: Different configurations work as expected

#### Deliverables:
- Task-aware content extraction working
- Vision analysis capabilities exposed
- Performance optimized with caching/pooling
- Full configurability of Hermes browser features
- Stress testing under concurrent load

### Phase 4: Testing, Documentation & Rollout (Weeks 7-8)
**Goal**: Comprehensive testing, documentation, and preparation for production use

#### Tasks:
1. **Comprehensive Test Suite**
   - Unit tests for all browser tool functions
   - Integration tests covering end-to-end browser flows
   - Failure scenario tests (network issues, timeouts, invalid inputs)
   - Performance benchmarks vs. pure Playwright implementation
   - **Test**: 95%+ test coverage for browser automation components

2. **Documentation**
   - Update `.kilo/docs/hermes-integration.md` with usage guide
   - Document configuration options and troubleshooting
   - Create examples for common browser automation patterns
   - Document fallback behavior and error handling
   - **Test**: Documentation is clear and actionable

3. **Production Readiness Review**
   - Security audit of integration points
   - Resource usage analysis (memory, CPU, subprocess overhead)
   - Compatibility testing with existing KORE-OS-TEP features
   - Rollout plan for enabling Hermes by default
   - **Test**: System meets production reliability standards

#### Deliverables:
- Comprehensive test suite with high coverage
- Complete documentation for Hermes integration
- Security and performance review completed
- Ready-for-production integration

## Technical Details

### Hermes MCP Server Setup
KORE-OS-TEP will start Hermes with:
```bash
hermes mcp serve --tools hermes-tools
# or via subprocess:
# hermes-agent-main/agent/transports/hermes_tools_mcp_server.py
```

The `hermes-tools` MCP server exposes these browser tools:
- `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`
- `browser_press`, `browser_scroll`, `browser_back`, `browser_get_images`
- `browser_console`, `browser_vision`, `vision_analyze`
- Plus other Hermes tools: `web_search`, `web_extract`, `skill_view`, etc.

### Parameter Mapping
KORE-OS-TEP → Hermes:
- `url` → `url` (string)
- `taskDescription` → `user_task` (string, for snapshot summarization)
- `sessionProfile` → `task_id` (string, for session isolation)
- `screenshotName` → handled internally (KORE-OS-TEP can implement screenshot saving)

### Response Format Conversion
Hermes returns JSON strings that need to be parsed and mapped to KORE-OS-TEP's expected format:
```typescript
// Hermes response example:
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "extracted_content": "Page content...",
  "screenshot": "/path/to/screenshot.png",
  "note": "Task executed: ..."
}

// KORE-OS-TEP expects similar structure in ToolResult.output
```

### Error Handling Strategy
1. **MCP Connection Errors**: Retry with exponential backoff, then fallback
2. **Tool Execution Errors**: Return Hermes error message, then fallback
3. **Timeouts**: Propagate Hermes timeout errors, then fallback
4. **Fallback Logic**: Only use Playwright if Hermes completely unavailable
5. **Logging**: Detailed logs for debugging integration issues

### Security Considerations
- Hermes provides SSRF protection, credential stripping for subprocesses
- KORE-OS-TEP should validate that Hermes security features are functioning
- Additional validation can be added in KORE-OS-TEP layer if needed
- All browser operations should respect KORE-OS-TEP's existing security guards

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Hermes MCP server fails to start | Medium | High | Fallback to Playwright, alert via logs |
| Increased latency from subprocess | Low | Medium | Connection pooling, keep-alive, benchmarks |
| Complexity of maintaining two browser systems | Medium | Low | Clear abstraction layer, fallback only when needed |
| Version conflicts between Hermes and KORE-OS-TEP | Low | Medium | Pin Hermes version, test upgrades separately |
| Resource overhead (memory/CPU) | Low | Low | Monitor usage, optimize connection pooling |

## Success Criteria
1. **Functionality**: All browser automation tasks work via Hermes when available
2. **Reliability**: Graceful fallback to Playwright when Hermes unavailable
3**. Overhead < 0.1% failure rate** in integration layer
3. **Performance**: <100ms overhead for MCP communication
4. **Fallback**: Seamless transition to Playwright when Hermes unavailable
5. **Security**: Inherits Hermes' SSRF and credential protection
6. **Maintainability**: Clear separation of concerns, well-documented
7. **Testability**: >90% test coverage for integration components

## Future Enhancements
After basic integration:
1. Expose Hermes' `delegate_task` for subagent orchestration in KORE-OS-TEP
2. Integrate Hermes' skills system for extensible capabilities
3. Use Hermes' session management for persistent browser contexts
4. Leverage Hermes' cron system for scheduled browser tasks
5. Integrate Hermes' TUI for debugging browser sessions
6. Use Hermes' plugin system for custom memory/context engines in KORE-OS-TEP

## Conclusion
This integration plan provides a path to leverage Hermes' superior browser automation capabilities while maintaining KORE-OS-TEP's architectural integrity. The MCP-based approach offers clean separation, graceful degradation, and access to Hermes' advanced features (multiple backends, security, vision capabilities, etc.) with minimal risk.