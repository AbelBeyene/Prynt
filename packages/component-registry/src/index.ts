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
  },
  AppBar: {
    name: "AppBar",
    allowedChildren: anyChildren,
    props: { title: { type: "string", required: true }, variant: { type: "string" } },
    defaults: { title: "Title", variant: "standard" },
    mobileCategory: "navigation"
  },
  SegmentedControl: {
    name: "SegmentedControl",
    allowedChildren: [],
    props: { options: { type: "string" }, selected: { type: "number" } },
    defaults: { options: "Overview|Activity|Settings", selected: 0 },
    mobileCategory: "navigation"
  },
  NavigationRail: {
    name: "NavigationRail",
    allowedChildren: anyChildren,
    props: { items: { type: "number" } },
    defaults: { items: 4 },
    mobileCategory: "navigation"
  },
  Drawer: {
    name: "Drawer",
    allowedChildren: anyChildren,
    props: { open: { type: "boolean" }, side: { type: "string" } },
    defaults: { open: false, side: "left" },
    mobileCategory: "navigation"
  },
  Breadcrumb: {
    name: "Breadcrumb",
    allowedChildren: [],
    props: { items: { type: "string" } },
    defaults: { items: "Home|Section|Page" },
    mobileCategory: "navigation"
  },
  Stepper: {
    name: "Stepper",
    allowedChildren: [],
    props: { steps: { type: "number" }, current: { type: "number" } },
    defaults: { steps: 4, current: 1 },
    mobileCategory: "navigation"
  },
  PaginationDots: {
    name: "PaginationDots",
    allowedChildren: [],
    props: { count: { type: "number" }, active: { type: "number" } },
    defaults: { count: 3, active: 1 },
    mobileCategory: "navigation"
  },
  PasswordField: {
    name: "PasswordField",
    allowedChildren: [],
    props: { label: { type: "string", required: true }, placeholder: { type: "string" }, minHeight: { type: "number" } },
    defaults: { label: "Password", placeholder: "••••••••", minHeight: 44 },
    mobileCategory: "input"
  },
  OTPInput: {
    name: "OTPInput",
    allowedChildren: [],
    props: { length: { type: "number" } },
    defaults: { length: 6 },
    mobileCategory: "input"
  },
  Slider: {
    name: "Slider",
    allowedChildren: [],
    props: { min: { type: "number" }, max: { type: "number" }, value: { type: "number" } },
    defaults: { min: 0, max: 100, value: 50 },
    mobileCategory: "input"
  },
  DatePicker: {
    name: "DatePicker",
    allowedChildren: [],
    props: { label: { type: "string" }, value: { type: "string" } },
    defaults: { label: "Date", value: "2026-03-25" },
    mobileCategory: "input"
  },
  TimePicker: {
    name: "TimePicker",
    allowedChildren: [],
    props: { label: { type: "string" }, value: { type: "string" } },
    defaults: { label: "Time", value: "09:00" },
    mobileCategory: "input"
  },
  FilePicker: {
    name: "FilePicker",
    allowedChildren: [],
    props: { label: { type: "string" }, accept: { type: "string" } },
    defaults: { label: "Upload file", accept: "image/*" },
    mobileCategory: "input"
  },
  AlertBanner: {
    name: "AlertBanner",
    allowedChildren: [],
    props: { text: { type: "string", required: true }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { text: "Heads up", tone: "accent" },
    mobileCategory: "content"
  },
  Snackbar: {
    name: "Snackbar",
    allowedChildren: [],
    props: { text: { type: "string", required: true }, action: { type: "string" } },
    defaults: { text: "Changes saved", action: "Undo" },
    mobileCategory: "content"
  },
  Toast: {
    name: "Toast",
    allowedChildren: [],
    props: { text: { type: "string", required: true } },
    defaults: { text: "Done" },
    mobileCategory: "content"
  },
  ProgressBar: {
    name: "ProgressBar",
    allowedChildren: [],
    props: { value: { type: "number" } },
    defaults: { value: 45 },
    mobileCategory: "content"
  },
  CircularProgress: {
    name: "CircularProgress",
    allowedChildren: [],
    props: { value: { type: "number" } },
    defaults: { value: 60 },
    mobileCategory: "content"
  },
  Skeleton: {
    name: "Skeleton",
    allowedChildren: [],
    props: { lines: { type: "number" } },
    defaults: { lines: 3 },
    mobileCategory: "content"
  },
  EmptyState: {
    name: "EmptyState",
    allowedChildren: anyChildren,
    props: { title: { type: "string" }, description: { type: "string" } },
    defaults: { title: "No results", description: "Try a different filter." },
    mobileCategory: "content"
  },
  Chip: {
    name: "Chip",
    allowedChildren: [],
    props: { text: { type: "string", required: true }, tone: { type: "string", tokenType: "colorRole" } },
    defaults: { text: "Chip", tone: "surface" },
    mobileCategory: "content"
  },
  Carousel: {
    name: "Carousel",
    allowedChildren: anyChildren,
    props: { slides: { type: "number" } },
    defaults: { slides: 3 },
    mobileCategory: "content"
  },
  Timeline: {
    name: "Timeline",
    allowedChildren: anyChildren,
    props: { items: { type: "number" } },
    defaults: { items: 4 },
    mobileCategory: "content"
  },
  BottomSheet: {
    name: "BottomSheet",
    allowedChildren: anyChildren,
    props: { open: { type: "boolean" }, title: { type: "string" } },
    defaults: { open: true, title: "Sheet" },
    mobileCategory: "content"
  },
  ActionSheet: {
    name: "ActionSheet",
    allowedChildren: anyChildren,
    props: { title: { type: "string" } },
    defaults: { title: "Actions" },
    mobileCategory: "content"
  },
  Popover: {
    name: "Popover",
    allowedChildren: anyChildren,
    props: { title: { type: "string" }, open: { type: "boolean" } },
    defaults: { title: "Popover", open: true },
    mobileCategory: "content"
  },
  Tooltip: {
    name: "Tooltip",
    allowedChildren: [],
    props: { text: { type: "string", required: true } },
    defaults: { text: "Helpful hint" },
    mobileCategory: "content"
  },
  Chart: {
    name: "Chart",
    allowedChildren: [],
    props: { type: { type: "string" }, points: { type: "number" } },
    defaults: { type: "line", points: 7 },
    mobileCategory: "content"
  },
  MapPreview: {
    name: "MapPreview",
    allowedChildren: [],
    props: { location: { type: "string" } },
    defaults: { location: "Berlin" },
    mobileCategory: "content"
  },
  VideoPlayer: {
    name: "VideoPlayer",
    allowedChildren: [],
    props: { title: { type: "string" }, duration: { type: "string" } },
    defaults: { title: "Demo Video", duration: "02:10" },
    mobileCategory: "content"
  },
  KanbanBoard: {
    name: "KanbanBoard",
    allowedChildren: anyChildren,
    props: { columns: { type: "number" } },
    defaults: { columns: 3 },
    mobileCategory: "content"
  },
  CalendarStrip: {
    name: "CalendarStrip",
    allowedChildren: [],
    props: { days: { type: "number" } },
    defaults: { days: 7 },
    mobileCategory: "content"
  },
  CommentThread: {
    name: "CommentThread",
    allowedChildren: anyChildren,
    props: { comments: { type: "number" } },
    defaults: { comments: 3 },
    mobileCategory: "content"
  },
  CommandPalette: {
    name: "CommandPalette",
    allowedChildren: anyChildren,
    props: { placeholder: { type: "string" }, open: { type: "boolean" } },
    defaults: { placeholder: "Type a command", open: false },
    mobileCategory: "navigation"
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
