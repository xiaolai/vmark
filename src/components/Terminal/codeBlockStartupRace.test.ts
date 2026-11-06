// WI-WCR2 — a restart after dispatch cannot rerun the same code block.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SessionEntry } from "./terminalSessionTypes";
const ipc=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:(...args:unknown[])=>ipc.invoke(...args),Channel:class {onmessage:((message:unknown)=>void)|null=null;}}));
vi.mock("@tauri-apps/api/event",()=>({listen:(...args:unknown[])=>ipc.listen(...args)}));
vi.unmock("@/lib/pty");
vi.mock("@/components/Terminal/terminalSpawnEnv",()=>({resolveLoginShellPath:async()=>"C:\\Windows\\System32",buildBaseTerminalEnv:()=>({}),buildShellSpawnConfig:async()=>({env:{},args:[]})}));
vi.mock("@/components/Terminal/windowsCodeBlockShell",()=>({resolveWindowsCodeBlockShell:async()=>"C:\\Windows\\System32\\cmd.exe"}));
vi.mock("@/services/terminal/transcriptBinding",()=>({prepareTranscriptBinding:async()=>"test-token"}));
vi.mock("@/components/Terminal/resolveTerminalSpawnContext",()=>({resolveTerminalSpawnContext:()=>({cwd:"C:/notes"})}));
import { useTerminalShellLifecycle } from "@/components/Terminal/useTerminalShellLifecycle";
import { resetTerminalSessionStore,useTerminalStore } from "@/stores/terminalStore";
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
afterEach(()=>{resetTerminalSessionStore();});
describe("internal startup race review",()=>{
  it("does not dispatch a code block twice when restart overlaps the accepted launcher write",async()=>{
    resetTerminalSessionStore();
    const writes:Array<{pid:number;data:string}>=[];
    const sources=new Map<number,string>();let nextPid=100;
    let releaseFirstWrite!:()=>void;
    const firstWriteAck=new Promise<void>(resolve=>{releaseFirstWrite=resolve;});
    ipc.listen.mockResolvedValue(()=>{});
    ipc.invoke.mockImplementation((name:string,args:{pid:number;data:string;codeBlock:{source:string}})=>{
      if(name==="pty_spawn_code_block"){const pid=nextPid++;sources.set(pid,args.codeBlock.source);return Promise.resolve({pid,command:"launch-script\r"});}
      if(name==="pty_write"){writes.push({pid:args.pid,data:args.data});return writes.length===1?firstWriteAck:Promise.resolve();}
      return Promise.resolve();
    });
    const session=useTerminalStore.getState().terminalCreateSession({windowsShell:"cmd",pendingCode:"echo once",requestedCwd:"C:/notes"})!;
    const term={cols:80,rows:24,options:{},onData:()=>({dispose:vi.fn()}),write:vi.fn((_data:unknown,parsed?:()=>void)=>parsed?.()),clear:vi.fn()};
    const entry={instance:{term,getCwd:()=>null,composing:false},pty:null,ptyRefForKeys:{current:null},spawnedCwd:undefined,shellStarted:false,shellExited:false,shellSpawning:false,disposed:false,spawnGen:0,pendingRafId:null} as unknown as SessionEntry;
    const sessionsRef={current:new Map([[session.id,entry]])};
    const {result,unmount}=renderHook(()=>useTerminalShellLifecycle(sessionsRef));
    let firstStartup!:Promise<void>;
    await act(async()=>{firstStartup=result.current.startShell(session.id);await flush();});
    expect(writes).toHaveLength(1);
    expect(useTerminalStore.getState().sessions[0].pendingCode).toBe("echo once");
    await act(async()=>{result.current.restartActiveSession();await flush();});
    releaseFirstWrite();await act(async()=>{await firstStartup;await flush();});

    const dispatched=writes.filter(write=>sources.get(write.pid)==="echo once");
    entry.pty?.kill();unmount();
    expect(dispatched).toHaveLength(1);
  });
});
