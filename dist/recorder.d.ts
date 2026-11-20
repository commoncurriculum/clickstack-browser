import { SessionProvider, SessionPublisher } from "@opentelemetry/browser-sdk/session";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
declare type addedNodeMutation = {
  parentId: number;
  previousId?: number | null;
  nextId: number | null;
  node: serializedNodeWithId;
};
declare type adoptedStyleSheetData = {
  source: IncrementalSource.AdoptedStyleSheet;
} & adoptedStyleSheetParam;
declare type adoptedStyleSheetParam = {
  id: number;
  styles?: {
    styleId: number;
    rules: styleSheetAddRule[];
  }[];
  styleIds: number[];
};
declare type annotationData = {
  type: 'caption';
  text: string | null | false;
} | {
  type: 'timelineMarker';
  text: string;
};
declare type annotationEvent = {
  type: EventType.Annotation;
  data: annotationData;
};
declare type assetEvent = {
  type: EventType.Asset;
  data: assetParam;
};
declare type assetParam = {
  url: string;
  payload: SerializedCanvasArg | SerializedCssTextArg;
  timestamp?: number;
} | {
  url: string;
  failed: {
    status?: number;
    message: string;
  };
};
declare type attributeMutation = {
  id: number;
  attributes: {
    [key: string]: string | styleOMValue | null;
  };
};
declare type attributes = cssTextKeyAttr & {
  [key: string]: string | number | true | null;
};
declare type CanvasArg = SerializedCanvasArg | string | number | boolean | null | CanvasArg[];
declare enum CanvasContext {
  '2D' = 0,
  WebGL = 1,
  WebGL2 = 2
}
declare type canvasMutationCommand = {
  property: string;
  args: Array<unknown>;
  setter?: true;
};
declare type canvasMutationData = {
  source: IncrementalSource.CanvasMutation;
} & canvasMutationParam;
declare type canvasMutationParam = {
  id: number;
  type: CanvasContext;
  commands: canvasMutationCommand[];
} | ({
  id: number;
  type: CanvasContext;
} & canvasMutationCommand);
declare type cdataNode = {
  type: NodeType.CDATA;
  textContent: '';
};
declare type commentNode = {
  type: NodeType.Comment;
  textContent: string;
};
declare type cssTextKeyAttr = {
  _cssText?: string;
};
declare type customElementData = {
  source: IncrementalSource.CustomElement;
} & customElementParam;
declare type customElementParam = {
  define?: {
    name: string;
  };
};
declare type customEvent<T = unknown> = {
  type: EventType.Custom;
  data: {
    tag: string;
    payload: T;
  };
};
declare type documentNode = {
  type: NodeType.Document;
  childNodes: serializedNodeWithId[];
  compatMode?: string;
};
declare type documentTypeNode = {
  type: NodeType.DocumentType;
  name: string;
  publicId: string;
  systemId: string;
};
declare type domContentLoadedEvent = {
  type: EventType.DomContentLoaded;
  data: unknown;
};
declare type elementNode = {
  type: NodeType.Element;
  tagName: string;
  attributes: attributes;
  childNodes: serializedNodeWithId[];
  isSVG?: true;
  needBlock?: boolean;
  isCustom?: true;
};
declare enum EventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
  Plugin = 6,
  Asset = 7,
  Annotation = 8
}
declare type eventWithoutTime = domContentLoadedEvent | loadedEvent | fullSnapshotEvent | incrementalSnapshotEvent | metaEvent | customEvent | annotationEvent | pluginEvent | assetEvent;
declare type eventWithTime = eventWithoutTime & {
  timestamp: number;
  delay?: number;
};
declare type fontData = {
  source: IncrementalSource.Font;
} & fontParam;
declare type fontParam = {
  family: string;
  fontSource: string;
  buffer: boolean;
  descriptors?: FontFaceDescriptors;
};
declare type fullSnapshotEvent = {
  type: EventType.FullSnapshot;
  data: {
    node: serializedNodeWithId;
    initialOffset: {
      top: number;
      left: number;
    };
  };
};
declare type incrementalData = mutationData | mousemoveData | mouseInteractionData | scrollData | viewportResizeData | inputData | mediaInteractionData | styleSheetRuleData | canvasMutationData | fontData | selectionData | styleDeclarationData | adoptedStyleSheetData | customElementData;
declare type incrementalSnapshotEvent = {
  type: EventType.IncrementalSnapshot;
  data: incrementalData;
};
declare enum IncrementalSource {
  Mutation = 0,
  MouseMove = 1,
  MouseInteraction = 2,
  Scroll = 3,
  ViewportResize = 4,
  Input = 5,
  TouchMove = 6,
  MediaInteraction = 7,
  StyleSheetRule = 8,
  CanvasMutation = 9,
  Font = 10,
  Log = 11,
  Drag = 12,
  StyleDeclaration = 13,
  Selection = 14,
  AdoptedStyleSheet = 15,
  CustomElement = 16
}
declare type inputData = {
  source: IncrementalSource.Input;
  id: number;
} & inputValue;
declare type inputValue = {
  text: string;
  isChecked: boolean;
  userTriggered?: boolean;
};
declare type loadedEvent = {
  type: EventType.Load;
  data: unknown;
};
declare type mediaInteractionData = {
  source: IncrementalSource.MediaInteraction;
} & mediaInteractionParam;
declare type mediaInteractionParam = {
  type: MediaInteractions;
  id: number;
  currentTime?: number;
  volume?: number;
  muted?: boolean;
  loop?: boolean;
  playbackRate?: number;
};
declare enum MediaInteractions {
  Play = 0,
  Pause = 1,
  Seeked = 2,
  VolumeChange = 3,
  RateChange = 4
}
declare type metaEvent = {
  type: EventType.Meta;
  data: {
    href: string;
    width: number;
    height: number;
  };
};
declare type mouseInteractionData = {
  source: IncrementalSource.MouseInteraction;
} & mouseInteractionParam;
declare type mouseInteractionParam = {
  type: MouseInteractions;
  id: number;
  x?: number;
  y?: number;
  pointerType?: PointerTypes;
};
declare enum MouseInteractions {
  MouseUp = 0,
  MouseDown = 1,
  Click = 2,
  ContextMenu = 3,
  DblClick = 4,
  Focus = 5,
  Blur = 6,
  TouchStart = 7,
  TouchMove_Departed = 8,
  TouchEnd = 9,
  TouchCancel = 10
}
declare type mousemoveData = {
  source: IncrementalSource.MouseMove | IncrementalSource.TouchMove | IncrementalSource.Drag;
  positions: mousePosition[];
};
declare type mousePosition = {
  x: number;
  y: number;
  id: number;
  timeOffset: number;
};
declare type mutationCallbackParam = {
  texts: textMutation[];
  attributes: attributeMutation[];
  removes: removedNodeMutation[];
  adds: addedNodeMutation[];
  isAttachIframe?: true;
};
declare type mutationData = {
  source: IncrementalSource.Mutation;
} & mutationCallbackParam;
declare enum NodeType {
  Document = 0,
  DocumentType = 1,
  Element = 2,
  Text = 3,
  CDATA = 4,
  Comment = 5
}
declare type pluginEvent<T = unknown> = {
  type: EventType.Plugin;
  data: {
    plugin: string;
    payload: T;
  };
};
declare enum PointerTypes {
  Mouse = 0,
  Pen = 1,
  Touch = 2
}
declare type removedNodeMutation = {
  parentId: number;
  id: number;
  isShadow?: boolean;
};
declare type scrollData = {
  source: IncrementalSource.Scroll;
} & scrollPosition;
declare type scrollPosition = {
  id: number;
  x: number;
  y: number;
};
declare type selectionData = {
  source: IncrementalSource.Selection;
} & selectionParam;
declare type selectionParam = {
  ranges: Array<SelectionRange>;
};
declare type SelectionRange = {
  start: number;
  startOffset: number;
  end: number;
  endOffset: number;
};
declare type SerializedBlobArg = {
  rr_type: 'Blob';
  data: Array<CanvasArg>;
  type?: string;
};
declare type SerializedCanvasArg = {
  rr_type: 'ArrayBuffer';
  base64: string;
} | SerializedBlobArg | {
  rr_type: string;
  src: string;
} | {
  rr_type: string;
  args: Array<CanvasArg>;
} | {
  rr_type: string;
  index: number;
};
declare type SerializedCssTextArg = {
  rr_type: 'CssText';
  cssTexts: string[];
};
declare type serializedNode = (documentNode | documentTypeNode | elementNode | textNode | cdataNode | commentNode) & {
  rootId?: number;
  isShadowHost?: boolean;
  isShadow?: boolean;
};
declare type serializedNodeWithId = serializedNode & {
  id: number;
};
declare type styleDeclarationData = {
  source: IncrementalSource.StyleDeclaration;
} & styleDeclarationParam;
declare type styleDeclarationParam = {
  id?: number;
  styleId?: number;
  index: number[];
  set?: {
    property: string;
    value: string | null;
    priority: string | undefined;
  };
  remove?: {
    property: string;
  };
};
declare type styleOMValue = {
  [key: string]: styleValueWithPriority | string | false;
};
declare type styleSheetAddRule = {
  rule: string;
  index?: number | number[];
};
declare type styleSheetDeleteRule = {
  index: number | number[];
};
declare type styleSheetRuleData = {
  source: IncrementalSource.StyleSheetRule;
} & styleSheetRuleParam;
declare type styleSheetRuleParam = {
  id?: number;
  styleId?: number;
  removes?: styleSheetDeleteRule[];
  adds?: styleSheetAddRule[];
  replace?: string;
  replaceSync?: string;
};
declare type styleValueWithPriority = [string, string];
declare type textMutation = {
  id: number;
  value: string | null;
};
declare type textNode = {
  type: NodeType.Text;
  textContent: string;
  isStyle?: true;
};
declare type viewportResizeData = {
  source: IncrementalSource.ViewportResize;
} & viewportResizeDimension;
declare type viewportResizeDimension = {
  width: number;
  height: number;
};
declare global {
  interface Window {
    FontFace: typeof FontFace;
  }
}
/**
 * The rrweb calls that replay makes. An app that runs rrweb itself passes its own, which then owns
 * masking. Its input events must carry `userTriggered` (rrweb's `userTriggeredOnInput: true`):
 * only user-typed input counts as session activity and ends the wait for the first input.
 *
 * @public
 */
interface RecordFunction {
  (options: {
    emit: (event: eventWithTime) => void;
    errorHandler: (error: unknown) => boolean;
  }): (() => void) | undefined;
  takeFullSnapshot(isCheckout?: boolean): void;
  mirror: {
    getNode(id: number): Node | null;
    getMeta(node: Node): unknown;
  };
}
/**
 * Who runs rrweb for the replay. A passed `record` owns masking, so the masking options cannot be
 * given beside it.
 *
 * @public
 */
type ReplayRecording<AppRecord = RecordFunction> = {
  record?: undefined;
  /**
   * Masks all text in the replay. With `false`, elements with the `rr-mask` class are still
   * masked. Default: `true`.
   */
  maskAllText?: boolean | undefined;
  /**
   * Masks the values of all inputs, text areas and selects in the replay. With `false`, only
   * passwords are masked. Default: `true`.
   */
  maskAllInputs?: boolean | undefined;
} | {
  /** An rrweb the app runs itself, for example to share one recording with another tool. */
  record: AppRecord;
  maskAllText?: never;
  maskAllInputs?: never;
};
export { ReplayRecording as n, RecordFunction as t };
