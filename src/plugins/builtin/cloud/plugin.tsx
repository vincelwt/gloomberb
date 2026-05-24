import type { ComponentType, ReactNode } from "react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { getSharedRegistry } from "../../registry";
import { apiClient } from "../../../api-client";
import { createGloomberbCloudCapabilities, createGloomberbCloudProvider } from "../../../sources/gloomberb-cloud";
import { chatController } from "../chat/controller";
import { registerCloudAuthCommands } from "./auth-commands";
import { AccountManagementPane } from "../account-management/pane";
import { BuildoutPane } from "../buildout/pane";
import {
  CONGRESS_TRADES_PANE_ID,
  CongressTradesPane,
} from "../congress-trades/pane";
import { registerTwitterFeedFeature } from "../cloud-tweets";
import {
  buildDmCommandResults,
  getLastVisitedChatChannelId,
  hasOnlyDmUsernameArgs,
  normalizeShortcutChannelId,
  openDmTargetFromCommand,
  parseDmUsernames,
} from "../chat/channels";

interface GloomberbCloudPluginComponents {
  ChatPane: (props: PaneProps) => ReactNode;
  ChatStatusWidget: ComponentType;
}

export function createGloomberbCloudPlugin({
  ChatPane,
  ChatStatusWidget,
}: GloomberbCloudPluginComponents): GloomPlugin {
  return {
    id: "gloomberb-cloud",
    name: "Gloomberb Cloud",
    version: "1.0.0",
    description: "Free market, macro, and chat services. Chat requires signup.",
    toggleable: true,
    order: 10,
    capabilities: createGloomberbCloudCapabilities(createGloomberbCloudProvider()),
    paneTemplates: [
      {
        id: "new-chat-pane",
        paneId: "chat",
        label: "New Chat Pane",
        description: "Open another floating chat window",
        keywords: ["new", "chat", "pane", "message"],
        shortcut: { prefix: "CHAT", argPlaceholder: "channel", argKind: "text" },
        createInstance: async (context, options) => {
          const channelId = options?.arg
            ? await chatController.resolveRequiredChannelId(normalizeShortcutChannelId(options.arg))
            : await chatController.resolvePreferredChannelId(getLastVisitedChatChannelId(context.config));
          return {
            placement: "floating",
            settings: { channelId },
          };
        },
      },
      {
        id: "account-management-pane",
        paneId: "account-management",
        label: "Account Management",
        description: "Edit your Gloomberb Cloud profile, password, and public portfolio sharing settings",
        keywords: ["account", "profile", "cloud", "acm", "password", "settings"],
        shortcut: { prefix: "ACM" },
        createInstance: () => ({
          placement: "floating",
        }),
      },
      {
        id: "buildout-pane",
        paneId: "buildout",
        label: "TheBuildout",
        description: "Open TheBuildout infrastructure intelligence.",
        keywords: ["tbo", "buildout", "thebuildout", "infrastructure", "sites", "intel"],
        shortcut: { prefix: "TBO" },
        createInstance: () => ({
          placement: "floating",
        }),
      },
      {
        id: "congress-trades-pane",
        paneId: CONGRESS_TRADES_PANE_ID,
        label: "Congress Trades",
        description: "Track newly disclosed House periodic transaction reports.",
        keywords: ["congress", "house", "trades", "ptr", "stock", "disclosures"],
        shortcut: { prefix: "CG" },
        createInstance: () => ({
          placement: "floating",
        }),
      },
    ],

    slots: {
      "status:widget": () => <ChatStatusWidget />,
    },

    setup(ctx) {
      chatController.attachPersistence(ctx.persistence, ctx.resume);
      chatController.setNotifier(ctx.notify);

      ctx.registerPane({
        id: "chat",
        name: "Chat",
        icon: "C",
        component: ChatPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 80, height: 30 },
      });

      ctx.registerPane({
        id: "account-management",
        name: "ACM",
        icon: "A",
        component: AccountManagementPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 72, height: 36 },
      });

      ctx.registerPane({
        id: "buildout",
        name: "TheBuildout",
        icon: "T",
        component: BuildoutPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 110, height: 34 },
      });

      ctx.registerPane({
        id: CONGRESS_TRADES_PANE_ID,
        name: "Congress",
        icon: "G",
        component: CongressTradesPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 112, height: 30 },
      });

      registerTwitterFeedFeature(ctx);

      ctx.registerShortcut({
        id: "toggle-chat",
        key: "c",
        shift: true,
        description: "Toggle chat",
        execute: () => {
          const registry = getSharedRegistry();
          if (registry?.isPaneFloating("chat")) {
            ctx.hidePane("chat");
          } else {
            ctx.showPane("chat");
          }
        },
      });

      ctx.registerCommand({
        id: "open-chat",
        label: "Chat",
        description: "Open chat",
        keywords: ["chat", "message", "messages"],
        category: "navigation",
        shortcut: "CHAT",
        execute: () => {
          ctx.showPane("chat");
        },
      });

      ctx.registerCommand({
        id: "direct-message",
        label: "DM",
        description: "Open an existing DM or start a direct/group chat",
        keywords: ["dm", "direct", "message", "group", "chat"],
        category: "navigation",
        shortcut: "DM",
        shortcutArg: {
          placeholder: "@username [@username...]",
          kind: "text",
          parse: (arg) => ({ participants: arg.trim() }),
        },
        buildResults: (arg) => buildDmCommandResults(ctx, arg),
        execute: async (values) => {
          const participants = values?.participants ?? values?.shortcut ?? "";
          const usernames = parseDmUsernames(participants);
          if (participants.trim() && !hasOnlyDmUsernameArgs(participants)) {
            throw new Error("Use @username, or multiple usernames for a group chat.");
          }
          await openDmTargetFromCommand(ctx, usernames);
        },
      });

      registerCloudAuthCommands(ctx);
    },

    dispose() {
      chatController.dispose();
      apiClient.dispose();
    },
  };
}
