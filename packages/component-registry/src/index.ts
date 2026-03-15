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
    props: { columns: { type: "number" }, gap: { type: "string", tokenType: "spacing" } },
    defaults: { columns: 2 },
    mobileCategory: "layout"
  },
  Container: {
    name: "Container",
    allowedChildren: anyChildren,
    props: {
      padding: { type: "string", tokenType: "spacing" },
      tone: { type: "string", tokenType: "colorRole" },
      radius: { type: "string", tokenType: "radius" }
    },
    defaults: { padding: "md", tone: "surface", radius: "md" },
    mobileCategory: "layout"
  },
  Spacer: {
    name: "Spacer",
    allowedChildren: [],
    props: { size: { type: "string", tokenType: "spacing" } },
    defaults: { size: "md" },
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
    allowedChildren: anyChildren,
    props: { tabs: { type: "number" } },
    defaults: { tabs: 4 },
    mobileCategory: "navigation"
  },
  Tabs: {
    name: "Tabs",
    allowedChildren: anyChildren,
    props: { label: { type: "string", required: true } },
    defaults: { label: "Tab" },
    mobileCategory: "navigation"
  },
  Navbar: {
    name: "Navbar",
    allowedChildren: anyChildren,
    props: { title: { type: "string", required: true } },
    defaults: { title: "Navigation" },
    mobileCategory: "navigation"
  },
  Sidebar: {
    name: "Sidebar",
    allowedChildren: anyChildren,
    props: { collapsed: { type: "boolean" } },
    defaults: { collapsed: false },
    mobileCategory: "navigation"
  },
  NavigationStack: {
    name: "NavigationStack",
    allowedChildren: anyChildren,
    props: { depth: { type: "number" } },
    defaults: { depth: 1 },
    mobileCategory: "navigation"
  },
  FloatingActionButton: {
    name: "FloatingActionButton",
    allowedChildren: [],
    props: { icon: { type: "string" }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { icon: "plus", tone: "primary" },
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
  Image: {
    name: "Image",
    allowedChildren: [],
    props: { src: { type: "string" }, alt: { type: "string" }, height: { type: "number" } },
    defaults: { src: "https://placehold.co/640x360", alt: "Placeholder image", height: 180 },
    mobileCategory: "content"
  },
  Icon: {
    name: "Icon",
    allowedChildren: [],
    props: { name: { type: "string", required: true }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { name: "sparkles", tone: "primary" },
    mobileCategory: "content"
  },
  Divider: {
    name: "Divider",
    allowedChildren: [],
    props: {},
    defaults: {},
    mobileCategory: "content"
  },
  Avatar: {
    name: "Avatar",
    allowedChildren: [],
    props: { initials: { type: "string", required: true }, size: { type: "string", enum: ["sm", "md", "lg"] } },
    defaults: { initials: "AB", size: "md" },
    mobileCategory: "content"
  },
  Badge: {
    name: "Badge",
    allowedChildren: [],
    props: { text: { type: "string", required: true }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { text: "New", tone: "accent" },
    mobileCategory: "content"
  },
  List: {
    name: "List",
    allowedChildren: anyChildren,
    props: { dense: { type: "boolean" } },
    defaults: {},
    mobileCategory: "content"
  },
  ListItem: {
    name: "ListItem",
    allowedChildren: anyChildren,
    props: { title: { type: "string", required: true }, subtitle: { type: "string" } },
    defaults: { title: "Item", subtitle: "" },
    mobileCategory: "content"
  },
  Table: {
    name: "Table",
    allowedChildren: [],
    props: { rows: { type: "number" }, columns: { type: "number" } },
    defaults: { rows: 3, columns: 3 },
    mobileCategory: "content"
  },
  Modal: {
    name: "Modal",
    allowedChildren: anyChildren,
    props: { title: { type: "string", required: true }, open: { type: "boolean" } },
    defaults: { title: "Modal", open: true },
    mobileCategory: "content"
  },
  PricingTable: {
    name: "PricingTable",
    allowedChildren: anyChildren,
    props: { tier: { type: "string" }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { tier: "Pro", tone: "primary" },
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
  },
  SearchBar: {
    name: "SearchBar",
    allowedChildren: [],
    props: { placeholder: { type: "string" }, minHeight: { type: "number" } },
    defaults: { placeholder: "Search", minHeight: 44 },
    mobileCategory: "input"
  },
  Toggle: {
    name: "Toggle",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, checked: { type: "boolean" } },
    defaults: { label: "Enabled", checked: false },
    mobileCategory: "input"
  },
  Checkbox: {
    name: "Checkbox",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, checked: { type: "boolean" } },
    defaults: { label: "Option", checked: false },
    mobileCategory: "input"
  },
  RadioGroup: {
    name: "RadioGroup",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, options: { type: "string" } },
    defaults: { label: "Options", options: "One|Two|Three" },
    mobileCategory: "input"
  },
  Picker: {
    name: "Picker",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, options: { type: "string" } },
    defaults: { label: "Pick", options: "A|B|C" },
    mobileCategory: "input"
  },
  Select: {
    name: "Select",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, options: { type: "string" } },
    defaults: { label: "Select", options: "One|Two|Three" },
    mobileCategory: "input"
  },
  Input: {
    name: "Input",
    allowedChildren: [],
    props: { placeholder: { type: "string" }, minHeight: { type: "number" } },
    defaults: { placeholder: "Type...", minHeight: 44 },
    mobileCategory: "input"
  },
  TextArea: {
    name: "TextArea",
    allowedChildren: [],
    props: { placeholder: { type: "string" }, rows: { type: "number" } },
    defaults: { placeholder: "Write here...", rows: 4 },
    mobileCategory: "input"
  },
  Form: {
    name: "Form",
    allowedChildren: anyChildren,
    props: { title: { type: "string" } },
    defaults: { title: "Form" },
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
