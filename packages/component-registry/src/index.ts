import type { TokenType } from "@prynt/tokens";

export type PropPrimitive = "string" | "number" | "boolean";

export interface ComponentPropDefinition {
  type: PropPrimitive;
  required?: boolean;
  enum?: readonly string[];
  tokenType?: TokenType;
}

export interface ComponentDefinition {
  name: string;
  allowedChildren: "any" | readonly string[];
  props: Record<string, ComponentPropDefinition>;
  defaults: Record<string, unknown>;
  mobileCategory: "layout" | "navigation" | "content" | "input";
}

const anyChildren = "any" as const;

export const componentDefinitions: Record<string, ComponentDefinition> = {
  Screen: {
    name: "Screen",
    allowedChildren: anyChildren,
    props: { title: { type: "string", required: true } },
    defaults: { title: "Untitled" },
    mobileCategory: "layout"
  },
  SafeArea: {
    name: "SafeArea",
    allowedChildren: anyChildren,
    props: {},
    defaults: {},
    mobileCategory: "layout"
  },
  ScrollView: {
    name: "ScrollView",
    allowedChildren: anyChildren,
    props: { padding: { type: "string", tokenType: "spacing" } },
    defaults: { padding: "md" },
    mobileCategory: "layout"
  },
  Stack: {
    name: "Stack",
    allowedChildren: anyChildren,
    props: {
      gap: { type: "string", tokenType: "spacing" },
      padding: { type: "string", tokenType: "spacing" }
    },
    defaults: { gap: "md", padding: "md" },
    mobileCategory: "layout"
  },
  Grid: {
    name: "Grid",
    allowedChildren: anyChildren,
    props: { columns: { type: "number" } },
    defaults: { columns: 2 },
    mobileCategory: "layout"
  },
  TopBar: {
    name: "TopBar",
    allowedChildren: [],
    props: { title: { type: "string", required: true } },
    defaults: { title: "Title" },
    mobileCategory: "navigation"
  },
  BottomTabBar: {
    name: "BottomTabBar",
    allowedChildren: ["Tabs"],
    props: { tabs: { type: "number" } },
    defaults: { tabs: 4 },
    mobileCategory: "navigation"
  },
  Tabs: {
    name: "Tabs",
    allowedChildren: [],
    props: { label: { type: "string", required: true } },
    defaults: { label: "Tab" },
    mobileCategory: "navigation"
  },
  Heading: {
    name: "Heading",
    allowedChildren: [],
    props: {
      text: { type: "string", required: true },
      size: { type: "string", tokenType: "fontSize" }
    },
    defaults: { text: "Heading", size: "xl" },
    mobileCategory: "content"
  },
  Text: {
    name: "Text",
    allowedChildren: [],
    props: { text: { type: "string", required: true } },
    defaults: { text: "Body" },
    mobileCategory: "content"
  },
  Card: {
    name: "Card",
    allowedChildren: anyChildren,
    props: {
      tone: { type: "string", tokenType: "colorRole" },
      radius: { type: "string", tokenType: "radius" }
    },
    defaults: { tone: "surface", radius: "lg" },
    mobileCategory: "content"
  },
  List: {
    name: "List",
    allowedChildren: ["ListItem"],
    props: {},
    defaults: {},
    mobileCategory: "content"
  },
  ListItem: {
    name: "ListItem",
    allowedChildren: [],
    props: { title: { type: "string", required: true } },
    defaults: { title: "Item" },
    mobileCategory: "content"
  },
  Button: {
    name: "Button",
    allowedChildren: [],
    props: {
      text: { type: "string", required: true },
      tone: { type: "string", tokenType: "colorRole" },
      size: { type: "string", enum: ["sm", "md", "lg"] },
      minHeight: { type: "number" }
    },
    defaults: { text: "Continue", tone: "primary", size: "md", minHeight: 44 },
    mobileCategory: "input"
  },
  TextField: {
    name: "TextField",
    allowedChildren: [],
    props: {
      label: { type: "string", required: true },
      placeholder: { type: "string" },
      minHeight: { type: "number" }
    },
    defaults: { label: "Label", placeholder: "Type...", minHeight: 44 },
    mobileCategory: "input"
  }
};

export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return componentDefinitions[type];
}

export function isAllowedChild(parentType: string, childType: string): boolean {
  const definition = getComponentDefinition(parentType);
  if (!definition) {
    return false;
  }
  if (definition.allowedChildren === "any") {
    return true;
  }
  return definition.allowedChildren.includes(childType);
}
