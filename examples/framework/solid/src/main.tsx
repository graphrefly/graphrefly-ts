/* @refresh reload */
import { render } from "solid-js/web";
import { Counter } from "./Counter";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
render(() => <Counter />, root);
