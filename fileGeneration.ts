import * as Types from './types';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import util from 'util';
import log from 'loglevel';
import * as SB3 from './SB3';
import * as Blocks from './blocks';

const nativeFunctions = {
  say: (id: string, args: Array<Types.ParsedInputValue>) =>
    args.length === 2
      ? new Blocks.SayForSecs(id, args[0], args[1])
      : new Blocks.Say(id, args[0]),
};

export class Sprite {
  functionsSoFar: number;
  parsedClass: Types.SpriteDef;
  constructor(parsedClass: Types.SpriteDef) {
    this.parsedClass = parsedClass;
    this.functionsSoFar = 0;
  }
  generateAndSave(
    stage: SB3.Target,
    broadcasts: Map<string, string>,
    pjson: SB3.SB3,
    stack: SB3.List
  ) {
    const sprite =
      this.parsedClass.name === 'Stage'
        ? stage
        : pjson.addSprite(
            new SB3.Target({
              isStage: false,
              name: this.parsedClass.name,
              variables: [],
              blocks: [],
              broadcasts: [],
              lists: [],
            })
          );
    for (const sfunction of this.parsedClass.functions.filter(
      (n) => n.type === 'functionDef'
    )) {
      let headBlock;
      if (sfunction.name === 'main' && sfunction.type === 'functionDef') {
        log.debug('Main function found, creating green flag event');
        // Create green flag function
        headBlock = SB3.Block.createTopLevelBlock(
          'event_whenflagclicked',
          [],
          [],
          this.functionsSoFar * 400 + 43
        );
      } else if (sfunction.type === 'functionDef') {
        const broadcastId = stage.addBroadcast(
          `function__${this.parsedClass.name}.${sfunction.name}`
        );
        headBlock = SB3.Block.createTopLevelBlock(
          'event_whenbroadcastreceived',
          [
            SB3.Field.createNewField(
              'BROADCAST_OPTION',
              `function__${this.parsedClass.name}.${sfunction.name}`,
              broadcastId
            ),
          ],
          [],
          this.functionsSoFar * 400 + 43
        );
        broadcasts.set(
          `${this.parsedClass.name}.${sfunction.name}`,
          broadcastId
        );
      }
      if (sfunction.type === 'functionDef') {
        if (!headBlock)
          throw new Error(
            `Failed to create head block for function ${sfunction.name}`
          );
        let lastBlock = headBlock;
        let varMappings: Map<string, number> = new Map();
        let stackShift = 0;
        for (const child of sfunction.codeLines) {
          let currBlock;
          if (child.type === 'functionCall') {
            const nativeFunction = Object.entries(nativeFunctions).find(
              (n) => n[0] === child.name
            );
            if (nativeFunction) {
              let nextId = uuidv4();
              const newArgs: Array<Types.ParsedInputValue> = child.args.map(
                (arg) => {
                  if (arg.type === 'objectLiteral')
                    return { type: 'objectLiteral', value: arg.value };
                  else {
                    const foundVar = varMappings.get(arg.name);
                    if (foundVar === undefined)
                      throw new Error(`Variable ${arg.name} does not exist`);
                    const newBlockId = uuidv4();
                    sprite.addBlock(
                      new Blocks.ItemFromListSimple(
                        newBlockId,
                        stack,
                        stackShift - foundVar,
                        nextId
                      )
                    );
                    return { type: 'blockReference', id: newBlockId };
                  }
                }
              );
              currBlock = lastBlock.addChild(
                nativeFunction[1](nextId, newArgs)
              );
            } else {
              const broadcastId = broadcasts.get(child.name);
              if (!broadcastId)
                throw new Error(
                  `Tried to call function ${child.name} but it doesn't exist`
                );
              currBlock = lastBlock.addChild(
                new Blocks.SendBroadcast(
                  broadcastId as string,
                  `function__${child.name}`,
                  child.async
                )
              );
            }
          } else if (child.type === 'variableDef') {
            currBlock = lastBlock.addChild(
              new Blocks.InsertIntoListSimple(stack, 1, child.value)
            );
            varMappings.set(child.name, stackShift);
            stackShift++;
          }
          sprite.addBlock(lastBlock);
          if (currBlock) lastBlock = currBlock;
        }
        while (stackShift > 0) {
          stackShift--;
          const currBlock = lastBlock.addChild(
            new Blocks.DeleteFromListSimple(stack, 1)
          );
          sprite.addBlock(lastBlock);
          lastBlock = currBlock;
        }
        sprite.addBlock(lastBlock);
      }
      this.functionsSoFar++;
    }
  }
}
export class Generator {
  data: AdmZip;
  constructor(data: AdmZip) {
    this.data = data;
  }
  exportToFile(file: string) {
    this.data.writeZip(file);
  }
  static blank() {
    return new Generator(new AdmZip());
  }
  createFromParse(parse: Array<Types.Token>): Generator {
    // Create project.json
    const pjson = SB3.SB3.empty();
    const stage = pjson.targets.find((n) => n.name === 'Stage');
    if (!stage) throw new Error('Failed to create stage, something went wrong');
    const stack = stage.addList('stack', []);
    const broadcasts: Map<string, string> = new Map();
    // Start parsing
    const spritesSoFar = new Set();
    for (const sprite of parse.filter((n) => n.type === 'spriteDef')) {
      if (spritesSoFar.has(sprite.name))
        throw new Error(`Sprite ${sprite.name} already exists`);
      spritesSoFar.add(sprite.name);
      new Sprite(sprite as Types.SpriteDef).generateAndSave(
        stage,
        broadcasts,
        pjson,
        stack
      );
    }
    console.log(
      util.inspect(pjson.json(), {
        showHidden: false,
        depth: null,
        colors: true,
      })
    );
    this.data.addFile(
      'project.json',
      Buffer.from(JSON.stringify(pjson.json()), 'utf-8')
    );
    // Add required stage backdrop
    this.data.addLocalFile('./cd21514d0531fdffb22204e0ec5ed84a.svg');
    return this;
  }
}
