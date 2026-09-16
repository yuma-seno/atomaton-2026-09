/**
 * shipped-servers.ts — the tool servers every run starts with, and the hooks that
 * watch all of them.
 *
 * # Why these are not in the config an adopter edits
 *
 * They were, and they were 70% of it. Sixty-six of ninety-three lines, in the one
 * file `.github/atoma/README.md` declares is yours, describing programs that are as
 * much machinery as the scripts under `tools/scripts/`.
 *
 * The line this sits on: **hide what breaks when it is edited wrong, show what
 * degrades.** A mistyped server name stops a run before a single tool starts, and a
 * deleted one takes a capability away from every agent that named it — the core
 * resolves `mcp_servers` against this list and aborts on the first miss. A skill or a
 * prompt template edited badly makes an agent less well-informed and the run
 * continues. Those two do not belong in the same file under the same label.
 *
 * # What an adopter can still do
 *
 * Everything they could before, and nothing they could not:
 *
 *   - add a server — a name that is not here is theirs, and is merged in
 *   - override any field of one that is here — same name, deep-merged, theirs wins
 *   - add a file-wide hook — appended after these, never replacing them
 *
 * Deleting is the one operation that is gone, and it was never needed: the core
 * starts only the servers an agent's `mcp_servers` names, so one nobody names costs
 * nothing. A project that has finished with `web` removes it from the agents, which
 * is where the decision belongs.
 *
 * # The descriptions
 *
 * `WHAT_EACH_IS_FOR` exists because the config used to show a reader what these
 * are — badly, as `bun run ${ATOMA_MACHINERY_ROOT}/...`, which is the implementation
 * rather than the meaning. `docs/configuration.md` and `.github/atoma/README.md` are
 * built to carry the meaning instead, and `shipped-servers.test.ts` holds every
 * server here to having one.
 */
import type { ConfiguredServer } from "./tools-file.ts";

/** The servers a run starts with, in the order they are written into the tools file. */
export const SHIPPED_SERVERS: Record<string, ConfiguredServer> = {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": [
        "."
      ],
      "env": {},
      "hooks": {
        "tool_denylist": [
          "filesystem__directory_tree"
        ],
        "after_tool": "./scripts/hooks/note_file_opened.ts"
      }
    },
    "filesystem_readonly": {
      "command": "mcp-server-filesystem",
      "args": [
        "."
      ],
      "env": {},
      "hooks": {
        "tool_allowlist": [
          "filesystem_readonly__read_file",
          "filesystem_readonly__read_multiple_files",
          "filesystem_readonly__read_media_file",
          "filesystem_readonly__list_directory",
          "filesystem_readonly__get_file_info"
        ],
        "after_tool": "./scripts/hooks/note_file_opened.ts"
      }
    },
    "shell": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/shell.ts"
      ],
      "env": {},
      "request_timeout_secs": 3600,
      "hooks": {
        "before_tool": "./scripts/hooks/shell_guard.ts"
      }
    },
    "github": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/github.ts"
      ],
      "env": {
        "GH_TOKEN": "${GH_TOKEN}"
      },
      "hooks": {}
    },
    "web": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/web.ts"
      ],
      "env": {},
      "hooks": {}
    },
    "search": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/search.ts"
      ],
      "env": {
        "GH_TOKEN": "${GH_TOKEN}"
      },
      "request_timeout_secs": 300,
      "hooks": {},
      "settings": {
        "reranker_model": "onnx-community/bge-reranker-v2-m3-ONNX"
      }
    },
    "atoma": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/atoma.ts"
      ],
      "env": {
        "GH_TOKEN": "${GH_TOKEN}"
      },
      "hooks": {}
    },
    "atoma_env": {
      "command": "bun",
      "args": [
        "run",
        "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/atoma.ts"
      ],
      "env": {
        "GH_TOKEN": "${GH_TOKEN}"
      },
      "hooks": {
        "tool_allowlist": [
          "atoma_env__reload_environment"
        ]
      }
    }
  };

/**
 * Hooks that run after every call to every server, before that server's own.
 *
 * A list because an adopter appends theirs to it. `tools.watch` in the config is
 * additions only — these are not removable, for the reason the file header gives.
 */
export const SHIPPED_WATCH: Record<string, string[]> = {
  after_tool: ["./scripts/hooks/workspace_guard.ts"],
};

/**
 * One line per shipped server, for the pages that list them.
 *
 * What it is for, not how it is started. A reader deciding whether to put `search` in
 * an agent's `mcp_servers` is not helped by its argv.
 */
export const WHAT_EACH_IS_FOR: Record<string, string> = {
  filesystem: "Reads and writes files in the work tree.",
  filesystem_readonly: "Reads files and nothing else, for agents that must not write.",
  shell: "Runs one foreground command. Guarded, and holds no credentials of its own.",
  github: "Issues, pull requests, comments, and every Git mutation.",
  web: "Fetches a URL. Searching the web is a skill, not a tool.",
  search: "Ranked search over this repository's issues and code.",
  atoma: "Atoma's own operations: sub-issues, handoffs, stopping a run.",
  atoma_env: "Rebuilding the run's environment, and nothing else.",
};
