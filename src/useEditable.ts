import { useState, useLayoutEffect, useMemo } from 'react';

export interface Position {
  position: number;
  content: string;
  line: number;
}

type History = [Position, string];

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'z';

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

const setStart = (range: Range, node: Node, offset: number) => {
  if (offset < node.textContent!.length) {
    range.setStart(node, offset);
  } else {
    range.setStartAfter(node);
  }
};

const setEnd = (range: Range, node: Node, offset: number) => {
  if (offset < node.textContent!.length) {
    range.setEnd(node, offset);
  } else {
    range.setEndAfter(node);
  }
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

const makeRange = (
  element: HTMLElement,
  start: number,
  end?: number
): Range => {
  if (!end) end = start;

  const range = document.createRange();
  const queue: Node[] = [element.firstChild!];
  let current = 0;

  let node: Node;
  let position = start;
  while ((node = queue[queue.length - 1])) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent!.length;
      if (current + length >= position) {
        const offset = position - current;
        if (position === start) {
          setStart(range, node, offset);
          if (end !== start) {
            position = end;
            continue;
          } else {
            break;
          }
        } else {
          setEnd(range, node, offset);
          break;
        }
      }

      current += node.textContent!.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      if (current + 1 >= position) {
        if (position === start) {
          setStart(range, node, 0);
          if (end !== start) {
            position = end;
            continue;
          } else {
            break;
          }
        } else {
          setEnd(range, node, 0);
          break;
        }
      }

      current++;
    }

    queue.pop();
    if (node.nextSibling) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  return range;
};

const setPosition = (
  element: HTMLElement,
  start: number,
  end?: number
): void => {
  const selection = window.getSelection()!;
  const range = makeRange(element, start, end);
  selection.empty();
  selection.addRange(range);
};

interface Options {
  disabled?: boolean;
  indentation?: number;
}

interface State {
  observer: MutationObserver;
  disconnected: boolean;
  onChange(text: string, position: Position): void;
  queue: MutationRecord[];
  history: History[];
  historyAt: number;
  position: number;
}

interface Edit {
  /** Replaces the entire content of the editable while adjusting the caret position. */
  update(content: string): void;
  /** Inserts new text at the caret position while deleting text in range of the offset (which accepts negative offsets). */
  insert(append: string, offset?: number): void;
}

export const useEditable = (
  elementRef: { current: HTMLElement | undefined | null },
  onChange: (text: string, position: Position) => void,
  opts?: Options
): Edit => {
  if (!opts) opts = {};

  const unblock = useState([])[1];
  const state: State = useState(() => {
    const state: State = {
      observer: null as any,
      disconnected: false,
      onChange,
      queue: [],
      history: [],
      historyAt: -1,
      position: -1,
    };

    if (typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(batch => {
        state.queue.push(...batch);
      });
    }

    return state;
  })[0];

  const edit = useMemo<Edit>(
    () => ({
      update(content: string) {
        const { current: element } = elementRef;
        if (element) {
          const position = getPosition(element);
          const prevContent = toString(element);
          position.position = state.position =
            position.position + (content.length - prevContent.length);
          state.onChange(content, position);
        }
      },
      insert(append: string, deleteOffset?: number) {
        const { current: element } = elementRef;
        if (element) {
          let range = window.getSelection()!.getRangeAt(0)!;
          range.deleteContents();
          range.collapse();
          const position = getPosition(element);
          const offset = deleteOffset || 0;
          const start = position.position + (offset < 0 ? offset : 0);
          const end = position.position + (offset > 0 ? offset : 0);
          range = makeRange(element, start, end);
          range.deleteContents();
          range.insertNode(document.createTextNode(append));
          setPosition(element, start + append.length);
        }
      },
    }),
    []
  );

  // Only for SSR / server-side logic
  if (typeof navigator !== 'object') return edit;

  useLayoutEffect(() => {
    state.onChange = onChange;

    if (!elementRef.current || opts!.disabled) return;

    state.disconnected = false;
    state.observer.observe(elementRef.current, observerSettings);
    if (state.position >= 0) {
      setPosition(elementRef.current, state.position);
    }

    return () => {
      state.observer.disconnect();
    };
  });

  useLayoutEffect(() => {
    if (!elementRef.current || opts!.disabled) {
      state.history.length = 0;
      state.historyAt = -1;
      return;
    }

    const element = elementRef.current!;
    if (state.position > -1) {
      element.focus();
      setPosition(element, state.position);
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
      if (!elementRef.current || state.position === -1) return;

      const content = toString(element);
      const position = getPosition(element);
      const timestamp = new Date().valueOf();

      // Prevent recording new state in list if last one has been new enough
      const lastEntry = state.history[state.historyAt];
      if (
        (!ignoreTimestamp && timestamp - _trackStateTimestamp < 500) ||
        (lastEntry && lastEntry[1] === content)
      ) {
        _trackStateTimestamp = timestamp;
        return;
      }

      const at = ++state.historyAt;
      state.history[at] = [position, content];
      state.history.splice(at + 1);
      if (at > 500) {
        state.historyAt--;
        state.history.shift();
      }
    };

    const disconnect = () => {
      state.observer.disconnect();
      state.disconnected = true;
    };

    const flushChanges = () => {
      const position = getPosition(element);
      state.queue.push(...state.observer.takeRecords());
      if (state.queue.length || position.position !== state.position) {
        disconnect();
        const content = toString(element);
        state.position = position.position;
        let mutation: MutationRecord | void;
        let i = 0;
        while ((mutation = state.queue.pop())) {
          if (mutation.oldValue !== null)
            mutation.target.textContent = mutation.oldValue;
          for (i = mutation.removedNodes.length - 1; i >= 0; i--)
            mutation.target.insertBefore(
              mutation.removedNodes[i],
              mutation.nextSibling
            );
          for (i = mutation.addedNodes.length - 1; i >= 0; i--)
            if (mutation.addedNodes[i].parentNode)
              mutation.target.removeChild(mutation.addedNodes[i]);
        }

        state.onChange(content, position);
      }
    };

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented || event.target !== element) {
        return;
      } else if (state.disconnected) {
        // React Quirk: It's expected that we may lose events while disconnected, which is why
        // we'd like to block some inputs if they're unusually fast. However, this always
        // coincides with React not executing the update immediately and then getting stuck,
        // which can be prevented by issuing a dummy state change.
        event.preventDefault();
        return unblock([]);
      }

      if (isUndoRedoKey(event)) {
        event.preventDefault();

        let history: History;
        if (!event.shiftKey) {
          const at = --state.historyAt;
          history = state.history[at];
          if (!history) state.historyAt = 0;
        } else {
          const at = ++state.historyAt;
          history = state.history[at];
          if (!history) state.historyAt = state.history.length - 1;
        }

        if (history) {
          disconnect();
          state.position = history[0].position;
          state.onChange(history[1], history[0]);
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
        edit.insert(text);
      } else if (!hasPlaintextSupport && event.key === 'Backspace') {
        event.preventDefault();
        const range = window.getSelection()!.getRangeAt(0)!;
        edit.insert('', range.collapsed ? -1 : 0);
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
        edit.update(newContent);
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
      state.position = getPosition(element).position;
    };

    const onBlur = () => {
      state.position = -1;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      trackState(true);
      edit.insert(event.clipboardData!.getData('text/plain'));
      trackState(true);
      flushChanges();
    };

    window.addEventListener('keydown', onKeyDown);
    element.addEventListener('focus', onFocus);
    element.addEventListener('blur', onBlur);
    element.addEventListener('paste', onPaste);
    element.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('focus', onFocus);
      element.removeEventListener('blur', onBlur);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('keyup', onKeyUp);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
  }, [elementRef.current!, opts!.disabled, opts!.indentation]);

  return edit;
};
