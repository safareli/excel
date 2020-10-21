import "react-virtualized/styles.css";
import "./Grid.css";

import { action, computed, makeObservable, observable } from "mobx";
import { observer } from "mobx-react-lite";
import * as React from "react";
import { AutoSizer, GridCellProps, MultiGrid } from "react-virtualized";

const alphabet = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
];

const alphabetToIdx = Object.fromEntries(
  alphabet.map((char, idx) => [char, idx])
);

type State = (Cell | null)[][];

type Address = { x: number; y: number };

const lookupCell = (state: State, address: Address): Cell | null => {
  return state[address.y][address.x];
};

const insertCell = (state: State, address: Address, cell: Cell) => {
  state[address.y][address.x] = cell;
};

type RefArg = { type: "ref"; address: Address };

type NumericArgs = { type: "const"; num: number } | RefArg;

type CellParsed =
  | { type: "const" }
  | { type: "invalid" }
  | { type: "ref"; address: Address }
  | { type: "sum"; args: NumericArgs[] }
  | { type: "product"; args: NumericArgs[] };

const eqAddress = (a: Address, b: Address) => {
  return a.x === b.x && a.y === b.y;
};

const isRefArg = (arg: NumericArgs): arg is RefArg => {
  return arg.type === "ref";
};

const dependencies = (parsed: CellParsed): Address[] => {
  switch (parsed.type) {
    case "const":
      return [];
    case "invalid":
      return [];
    case "ref":
      return [parsed.address];
    case "sum":
      return parsed.args.filter(isRefArg).map((x) => x.address);
    case "product":
      return parsed.args.filter(isRefArg).map((x) => x.address);
  }
};

const parseRef = (argTrimmed: string): Address | null => {
  const refMatch = argTrimmed.match(/^([A-Z])([0-9]+)$/i);
  if (refMatch != null) {
    const x = alphabetToIdx[refMatch[1].toUpperCase()];
    const y = Number(refMatch[2]);
    return { x, y };
  }
  return null;
};

const parseNumericArgs = (argsStrings: string[]): null | NumericArgs[] => {
  const args: NumericArgs[] = [];
  for (const arg of argsStrings) {
    const argTrimmed = arg.trim();
    const address = parseRef(argTrimmed);
    if (address != null) {
      args.push({ type: "ref", address: address });
      continue;
    }
    const num = Number(argTrimmed);
    if (!isNaN(num)) {
      args.push({ type: "const", num });
      continue;
    }
    return null;
  }
  if (args.length === 0) {
    return null;
  }
  return args;
};

const parseCellContents = (value: string): CellParsed => {
  const val = value.trim();
  if (val[0] === undefined || val[0] !== "=") {
    return { type: "const" };
  }
  const openParenPos = val.indexOf("(");
  if (openParenPos === -1) {
    const address = parseRef(val.slice(1).trim());
    if (address !== null) {
      return { type: "ref", address };
    }
    return { type: "invalid" };
  }
  const func = val.slice(1, openParenPos).toLowerCase();

  const argsWithParens = val.slice(openParenPos);
  if (argsWithParens[argsWithParens.length - 1] !== ")") {
    return { type: "invalid" };
  }
  if (argsWithParens[argsWithParens.length - 1] !== ")") {
    return { type: "invalid" };
  }
  const argsStrings = argsWithParens
    .slice(1, argsWithParens.length - 1)
    .split(",");

  if (func === "sum" || func === "product") {
    const args = parseNumericArgs(argsStrings);
    if (args == null) {
      return { type: "invalid" };
    }
    return { type: func, args };
  }
  return { type: "invalid" };
};

type Monoid<T> = {
  empty: T;
  concat: (a: T, b: T) => T;
};

const sum: Monoid<number> = {
  empty: 0,
  concat: (a, b) => a + b,
};

const product: Monoid<number> = {
  empty: 1,
  concat: (a, b) => a * b,
};

function asNumber<T>(x: string, def: T): T | number {
  const num = Number(x);
  return isNaN(num) ? def : num;
}

const readNumber = (cell: Cell | null, def: number): number => {
  const value = cell?.value;
  return value === undefined
    ? def
    : typeof value === "number"
    ? value
    : asNumber(value, def);
};

const evalNumericFunction = (
  state: State,
  args: NumericArgs[],
  m: Monoid<number>
): number => {
  let res = m.empty;
  for (let i = 0; i < args.length; i++) {
    const arg: NumericArgs = args[i];
    switch (arg.type) {
      case "const":
        res = m.concat(res, arg.num);
        break;
      case "ref":
        res = m.concat(
          res,
          readNumber(lookupCell(state, arg.address), m.empty)
        );
        break;
    }
  }
  return res;
};
class Cell {
  raw: string;

  private state: State;

  constructor(state: State, raw: string) {
    this.raw = raw;
    this.state = state;
    makeObservable(this, {
      raw: observable,
      setRaw: action,
      value: computed,
    });
  }

  setRaw(value: string) {
    this.raw = value;
  }

  get parsed() {
    return parseCellContents(this.raw);
  }

  get dependencies() {
    return dependencies(this.parsed);
  }

  get value(): string | number {
    switch (this.parsed.type) {
      case "const":
        return this.raw;
      case "invalid":
        return "INVALID";
      case "ref":
        return lookupCell(this.state, this.parsed.address)?.value || "";
      case "sum":
        return evalNumericFunction(this.state, this.parsed.args, sum);
      case "product":
        return evalNumericFunction(this.state, this.parsed.args, product);
    }
  }
}

const makeMatrix = (cols: number, rows: number): State => {
  const res: State = [];
  for (let i = 0; i < rows; i++) {
    res[i] = [];
    for (let j = 0; j < cols; j++) {
      res[i][j] = new Cell(res, "");
    }
  }
  return res;
};

const hasDependencyCycle = (
  state: State,
  address: Address,
  value: string
): boolean =>
  dependencies(parseCellContents(value)).some(function hasLoop(depAddress) {
    if (eqAddress(address, depAddress)) {
      return true;
    }

    const depCel = lookupCell(state, depAddress);
    if (depCel == null) {
      return false;
    }
    return depCel.dependencies.some(hasLoop);
  });

const newValue = (state: State, address: Address, value: string) => {
  const cell = lookupCell(state, address);
  if (cell === null) {
    insertCell(state, address, new Cell(state, value));
  } else {
    cell.setRaw(value);
  }
};

type CellProps = {
  columnIndex: number;
  rowIndex: number;
  matrix: State;
};

const CellRenderer = observer(
  ({ columnIndex, matrix, rowIndex }: CellProps) => {
    const address = { x: columnIndex, y: rowIndex };
    const cell = lookupCell(matrix, address);
    const [edit, setEdit] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const value = edit !== null ? edit : cell != null ? cell.value : "";
    React.useEffect(() => {
      if (edit == null) {
        return;
      }
      inputRef.current!.focus();
    }, [edit]);
    const startEdit = () => setEdit(cell == null ? "" : cell.raw);
    return edit == null ? (
      <div
        tabIndex={0}
        onFocus={startEdit}
        onClick={startEdit}
        className="Grid-cellContent"
        children={cell != null ? cell.value : ""}
      />
    ) : (
      <input
        ref={inputRef}
        className="Grid-cellContent"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            inputRef.current!.blur();
          }
        }}
        onBlur={() => {
          setEdit(null);
          if (hasDependencyCycle(matrix, address, edit)) {
            alert("Dependency cycle was detected, change discarded!");
            return;
          }
          newValue(matrix, address, edit!);
        }}
        onChange={(event) => setEdit(event.target.value)}
        value={value}
      />
    );
  }
);

const GridNode = React.memo(({ columnIndex, matrix, rowIndex }: CellProps) => {
  if (columnIndex === 0 && rowIndex === 0) {
    return <div className="Grid-cellContent"></div>;
  }
  if (columnIndex === 0) {
    return <div className="Grid-cellContent">{rowIndex - 1}</div>;
  }
  if (rowIndex === 0) {
    return <div className="Grid-cellContent">{alphabet[columnIndex - 1]}</div>;
  }
  return (
    <CellRenderer
      matrix={matrix}
      columnIndex={columnIndex - 1}
      rowIndex={rowIndex - 1}
    />
  );
});

export const Grid = () => {
  const matrix: State = React.useMemo(
    () => makeMatrix(alphabet.length, 1000),
    []
  );
  const columnWidth = 120;
  const rowHeight = 30;
  const overscanCount = 5;
  return (
    <div className="Grid">
      <AutoSizer>
        {({ width, height }) => (
          <MultiGrid
            cellRenderer={({
              key,
              style,
              columnIndex,
              rowIndex,
            }: GridCellProps) => {
              const frozenClass =
                columnIndex === 0 || rowIndex === 0 ? "Grid-cell--frozen" : "";
              return (
                <div className={frozenClass} {...{ key, style }}>
                  <GridNode
                    matrix={matrix}
                    columnIndex={columnIndex}
                    rowIndex={rowIndex}
                  />
                </div>
              );
            }}
            fixedColumnCount={1}
            fixedRowCount={1}
            rowHeight={rowHeight}
            rowCount={matrix.length + 1}
            columnWidth={columnWidth}
            columnCount={alphabet.length + 1}
            height={height}
            width={width}
            overscanColumnCount={overscanCount}
            overscanRowCount={overscanCount}
          />
        )}
      </AutoSizer>
    </div>
  );
};
