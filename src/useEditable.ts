/* eslint-disable */
import {
  RefObject,
  useCallback,
  useReducer,
  useRef,
  useLayoutEffect,
} from 'react';

interface Position {
  position: number;
  content: string;
  line: number;
}

interface State {
  position: Position;
  content: string;
}

type ChangeHandler = (text: string, position: Position) => void;
type UpdateAction = (content: string) => void;

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.code === 'KeyZ';

const toString = (element: HTMLElement): string => {
  const queue: Node[] = [element.firstChild!];

  let content = '';
  let node: Node;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      content += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      content += '\n';
    }

    if (node.nextSibling) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  // contenteditable Quirk: Without plaintext-only a pre/pre-wrap element must always
  // end with at least one newline character
  if (content[content.length - 1] !== '\n') content += '\n';

  return content;
};

const getPosition = (element: HTMLElement): Position => {
  const selection = window.getSelection()!;
  const queue: Node[] = [element.firstChild!];

  // Without plaintext-only mode we may get a node and an offset of one of its children
  // if the selection happens to land in-between nodes
  let { focusNode, focusOffset } = selection;
  if (focusNode && focusNode.nodeType !== Node.TEXT_NODE) {
    if (focusOffset <= focusNode.childNodes.length - 1)
      focusNode = focusNode.childNodes[focusOffset];
    focusOffset = 0;
  }

  let position = 0;
  let line = 0;
  let content = '';
  let node: Node | void;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      let textContent = node.textContent!;
      if (node === focusNode) {
        textContent = textContent.slice(0, focusOffset);
      }

      position += textContent.length;
      content += textContent;
      const newlineRe = /\n/g;

      let match: RegExpExecArray | null;
      while ((match = newlineRe.exec(textContent))) {
        content = textContent.slice(match.index + 1);
        line++;
      }

      if (node === focusNode) break;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      content = '';
      line++;
      position++;
    }

    if (node.nextSibling && node !== focusNode) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  return {
    position,
    content,
    line,
  };
};

const setPosition = (element: HTMLElement, position: number): void => {
  const selection = window.getSelection()!;
  const range = document.createRange();
  const queue: Node[] = [element.firstChild!];
  let current = 0;

  let node: Node;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent!.length;
      if (current + length >= position) {
        const offset = position - current;
        if (offset === length) {
          range.setStartAfter(node);
        } else {
          range.setStart(node, offset);
        }
        break;
      }

      current += node.textContent!.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      if (current + 1 >= position) {
        range.setStartAfter(node);
        break;
      }

      current++;
    }

    if (node.nextSibling) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  selection.empty();
  selection.addRange(range);
};

const insert = (text: string) => {
  const selection = window.getSelection()!;
  let range = window.getSelection()!.getRangeAt(0)!;
  const node = document.createTextNode(text);
  selection.getRangeAt(0).deleteContents();
  range.insertNode(node);
  range = document.createRange();
  range.setStartAfter(node);
  selection.empty();
  selection.addRange(range);
};

interface Options {
  disabled?: boolean;
  indentation?: number;
}

export const useEditable = (
  elementRef: RefObject<HTMLElement>,
  onChange: ChangeHandler,
  opts?: Options
): UpdateAction => {
  if (!opts) opts = {};

  const unblock = useReducer(x => x + 1, 0)[1];
  const onChangeRef = useRef(onChange);
  const positionRef = useRef(-1);
  const statesRef = useRef<State[]>([]);
  const stateAtRef = useRef(-1);
  const queueRef = useRef<MutationRecord[]>([]);
  const addMutationsToQueue = (list: MutationRecord[]) => {
    for (let i = 0; i < list.length; i++) queueRef.current.push(list[i]);
  };

  const disconnectedRef = useRef(false);
  const observerRef = useRef(new MutationObserver(addMutationsToQueue));

  onChangeRef.current = onChange;

  const update = useCallback((content: string) => {
    const { current: element } = elementRef;
    if (element) {
      const position = getPosition(element);
      const prevContent = toString(element);
      positionRef.current =
        position.position + (content.length - prevContent.length);
      onChangeRef.current(content, position);
    }
  }, []);

  // Only for SSR / server-side logic
  if (typeof navigator !== 'object') return update;

  useLayoutEffect(() => {
    if (!elementRef.current || opts!.disabled) return;

    disconnectedRef.current = false;
    observerRef.current.observe(elementRef.current, observerSettings);
    if (positionRef.current >= 0) {
      setPosition(elementRef.current, positionRef.current);
    }

    return () => {
      observerRef.current.disconnect();
    };
  });

  useLayoutEffect(() => {
    if (!elementRef.current || opts!.disabled) {
      statesRef.current.length = 0;
      stateAtRef.current = -1;
      return;
    }

    const element = elementRef.current!;
    if (positionRef.current > -1) {
      element.focus();
      setPosition(element, positionRef.current);
    }

    const prevWhiteSpace = element.style.whiteSpace;
    const prevContentEditable = element.contentEditable;
    let hasPlaintextSupport = true;
    try {
      // Firefox and IE11 do not support plaintext-only mode
      element.contentEditable = 'plaintext-only';
    } catch (_error) {
      element.contentEditable = 'true';
      hasPlaintextSupport = false;
    }

    if (prevWhiteSpace !== 'pre') element.style.whiteSpace = 'pre-wrap';

    if (opts!.indentation) {
      element.style.tabSize = (element.style as any).MozTabSize =
        '' + opts!.indentation;
    }

    const indentRe = new RegExp(
      `^(?:${' '.repeat(opts!.indentation || 0)}|\\t)`
    );

    let _trackStateTimestamp: number;
    const trackState = (ignoreTimestamp?: boolean) => {
      if (!elementRef.current || positionRef.current === -1) return;

      const { current: states } = statesRef;
      const content = toString(element);
      const position = getPosition(element);
      const timestamp = new Date().valueOf();

      // Prevent recording new state in list if last one has been new enough
      const lastState = states[stateAtRef.current];
      if (
        (!ignoreTimestamp && timestamp - _trackStateTimestamp < 500) ||
        (lastState && lastState.content === content)
      ) {
        _trackStateTimestamp = timestamp;
        return;
      }

      const at = ++stateAtRef.current;
      states[at] = { content, position };
      states.splice(at + 1);
      if (at > 500) {
        stateAtRef.current--;
        states.shift();
      }
    };

    const disconnect = () => {
      observerRef.current.disconnect();
      disconnectedRef.current = true;
    };

    const flushChanges = () => {
      addMutationsToQueue(observerRef.current.takeRecords());
      if (queueRef.current.length > 0) {
        disconnect();
        const content = toString(element);
        const position = getPosition(element);
        positionRef.current = position.position;
        let mutation: MutationRecord | void;
        let i = 0;
        while ((mutation = queueRef.current.pop())) {
          if (mutation.oldValue !== null)
            mutation.target.textContent = mutation.oldValue;
          for (i = mutation.removedNodes.length - 1; i >= 0; i--)
            mutation.target.insertBefore(
              mutation.removedNodes[i],
              mutation.nextSibling
            );
          for (i = mutation.addedNodes.length - 1; i >= 0; i--)
            mutation.target.removeChild(mutation.addedNodes[i]);
        }

        onChangeRef.current(content, position);
      }
    };

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented) {
        return;
      } else if (disconnectedRef.current) {
        // React Quirk: It's expected that we may lose events while disconnected, which is why
        // we'd like to block some inputs if they're unusually fast. However, this always
        // coincides with React not executing the update immediately and then getting stuck,
        // which can be prevented by issuing a dummy state change.
        event.preventDefault();
        return unblock();
      }

      if (isUndoRedoKey(event)) {
        event.preventDefault();

        let state: State;
        if (!event.shiftKey) {
          const at = --stateAtRef.current;
          state = statesRef.current[at];
          if (!state) stateAtRef.current = 0;
        } else {
          const at = ++stateAtRef.current;
          state = statesRef.current[at];
          if (!state) stateAtRef.current = statesRef.current.length - 1;
        }

        if (state) {
          disconnect();
          positionRef.current = state.position.position;
          onChangeRef.current(state.content, state.position);
        }
        return;
      } else {
        trackState();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        // Firefox / IE11 Quirk: Since plaintext-only is unsupported we must
        // ensure that only newline characters are inserted
        const position = getPosition(element);
        // We also get the current line and preserve indentation for the next
        // line that's created
        const match = /\S/g.exec(position.content);
        const index = match ? match.index : position.content.length;
        const text = '\n' + position.content.slice(0, index);
        insert(text);
      } else if (!hasPlaintextSupport && event.key === 'Backspace') {
        event.preventDefault();
        const range = window.getSelection()!.getRangeAt(0)!;
        if (
          range.startContainer !== range.endContainer ||
          range.startOffset !== range.endOffset
        ) {
          range.deleteContents();
        } else {
          // Firefox Quirk: Backspacing won't preserve the correct position
          // so it's easier to reimplement it and skip rendering for normal backspacing
          disconnect();
          const position = getPosition(element);
          const index = Math.max(0, position.position - 1);
          const content = toString(element);
          update(content.slice(0, index) + content.slice(index + 1));
        }
      } else if (opts!.indentation && event.key === 'Tab') {
        event.preventDefault();
        const position = getPosition(element);
        const start = position.position - position.content.length;
        const content = toString(element);
        const newContent = event.shiftKey
          ? content.slice(0, start) +
            position.content.replace(indentRe, '') +
            content.slice(start + position.content.length)
          : content.slice(0, start) + '\t' + content.slice(start);
        update(newContent);
      }
    };

    const onKeyUp = (event: HTMLElementEventMap['keyup']) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isUndoRedoKey(event)) trackState();
      flushChanges();
      // Chrome Quirk: The contenteditable may lose focus after the first edit or so
      element.focus();
    };

    const onFocus = () => {
      positionRef.current = getPosition(element).position;
    };

    const onBlur = () => {
      positionRef.current = -1;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      trackState(true);
      insert(event.clipboardData!.getData('text/plain'));
      trackState(true);
      flushChanges();
    };

    element.addEventListener('focus', onFocus);
    element.addEventListener('blur', onBlur);
    element.addEventListener('paste', onPaste);
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('keyup', onKeyUp);

    return () => {
      element.removeEventListener('focus', onFocus);
      element.removeEventListener('blur', onBlur);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('keyup', onKeyUp);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
  }, [elementRef.current!, opts!.disabled, opts!.indentation]);

  return update;
};
