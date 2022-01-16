import _ from 'lodash';
import { IBoxBounds, rectangleDistance, rectangleIntersectArea, Vector2D } from './designerMath';

const MIN_NODE_DISTANCE = 50;
const SPRING_LENGTH = 100;
const SPRINGY_STEPS = 50;
const GRAVITY = 0.01;
const REPULSION = 500_000;
const MAX_FORCE_SIZE = 100;
const NODE_MARGIN = 20;
const MOVE_STEP = 20;
const MOVE_BIG_STEP = 70;
const MOVE_STEP_COUNT = 1000;
const MINIMAL_SCORE_BENEFIT = 1;

class GraphNode {
  neightboors: GraphNode[] = [];
  radius: number;
  constructor(public graph: GraphDefinition, public designerId: string, public width: number, public height: number) {}

  initialize() {
    this.radius = Math.sqrt((this.width * this.width) / 4 + (this.height * this.height) / 4);
  }
}

class GraphEdge {
  constructor(public graph: GraphDefinition, public source: GraphNode, public target: GraphNode) {}
}

// function initialCompareNodes(a: GraphNode, b: GraphNode) {
//   if (a.neightboors.length < b.neightboors.length) return -1;
//   if (a.neightboors.length > b.neightboors.length) return 1;

//   if (a.height < b.height) return -1;
//   if (a.height > b.height) return 1;

//   return;
// }

export class GraphDefinition {
  nodes: { [designerId: string]: GraphNode } = {};
  edges: GraphEdge[] = [];

  addNode(designerId: string, width: number, height: number) {
    this.nodes[designerId] = new GraphNode(this, designerId, width, height);
  }

  addEdge(sourceId: string, targetId: string) {
    const source = this.nodes[sourceId];
    const target = this.nodes[targetId];
    if (
      source &&
      target &&
      !this.edges.find(x => (x.source == source && x.target == target) || (x.target == source && x.source == target))
    ) {
      this.edges.push(new GraphEdge(this, source, target));
    }
  }

  initialize() {
    for (const node of Object.values(this.nodes)) {
      for (const edge of this.edges) {
        if (edge.source == node && !node.neightboors.includes(edge.target)) node.neightboors.push(edge.target);
        if (edge.target == node && !node.neightboors.includes(edge.source)) node.neightboors.push(edge.source);
      }
      node.initialize();
    }
  }
}

class LayoutNode {
  position: Vector2D;
  left: number;
  right: number;
  top: number;
  bottom: number;
  paddedRect: IBoxBounds;

  constructor(public node: GraphNode, public x: number, public y: number) {
    this.left = x - node.width / 2;
    this.top = y - node.height / 2;
    this.right = x + node.width / 2;
    this.bottom = y + node.height / 2;
    this.position = new Vector2D(x, y);

    this.paddedRect = {
      left: this.left - NODE_MARGIN,
      top: this.top - NODE_MARGIN,
      right: this.right + NODE_MARGIN,
      bottom: this.bottom + NODE_MARGIN,
    };
  }

  translate(dx: number, dy: number) {
    return new LayoutNode(this.node, this.x + dx, this.y + dy);
  }

  distanceTo(node: LayoutNode) {
    return rectangleDistance(this, node);
  }

  intersectArea(node: LayoutNode) {
    return rectangleIntersectArea(this.paddedRect, node.paddedRect);
  }
}

class ForceAlgorithmStep {
  nodeForces: { [designerId: string]: Vector2D } = {};
  constructor(public layout: GraphLayout) {}

  applyForce(node: LayoutNode, force: Vector2D) {
    // if (node.node.designerId == '7ef3dd10-6ec0-11ec-b179-6d02a7c011ad') {
    //   console.log('APPLY', node.node.designerId, force.x, force.y);
    // }

    const size = force.magnitude();
    if (size > MAX_FORCE_SIZE) {
      force = force.normalise().multiply(MAX_FORCE_SIZE);
    }

    if (node.node.designerId in this.nodeForces) {
      this.nodeForces[node.node.designerId] = this.nodeForces[node.node.designerId].add(force);
    } else {
      this.nodeForces[node.node.designerId] = force;
    }
  }

  applyCoulombsLaw() {
    // console.log('****** COULOMB');

    for (const n1 of _.values(this.layout.nodes)) {
      for (const n2 of _.values(this.layout.nodes)) {
        if (n1.node.designerId == n2.node.designerId) {
          continue;
        }

        const d = n1.position.subtract(n2.position);
        const direction = d.normalise();
        const distance = n1.distanceTo(n2) + MIN_NODE_DISTANCE;

        this.applyForce(n1, direction.multiply((+0.5 * REPULSION) / (distance * distance)));
        this.applyForce(n2, direction.multiply((-0.5 * REPULSION) / (distance * distance)));
      }
    }
  }

  applyHooksLaw() {
    for (const edge of this.layout.edges) {
      const d = edge.target.position.subtract(edge.source.position); // the direction of the spring
      const displacement = SPRING_LENGTH - edge.length;
      var direction = d.normalise();

      // apply force to each end point
      this.applyForce(edge.source, direction.multiply(displacement * -0.5));
      this.applyForce(edge.target, direction.multiply(displacement * +0.5));
    }
  }

  applyGravity() {
    for (const node of _.values(this.layout.nodes)) {
      var direction = node.position.multiply(-1.0);
      this.applyForce(node, direction.multiply(GRAVITY));
    }
  }

  moveNode(node: LayoutNode): LayoutNode {
    const force = this.nodeForces[node.node.designerId];
    if (force) {
      return node.translate(force.x, force.y);
    }
    return node;
  }
}

class LayoutEdge {
  edge: GraphEdge;
  length: number;
  source: LayoutNode;
  target: LayoutNode;
}

function addNodeNeighboors(nodes: GraphNode[], res: GraphNode[], addedNodes: Set<string>) {
  const nodesSorted = _.sortBy(nodes, [x => x.neightboors.length, x => x.height, x => x.designerId]);
  for (const node of nodesSorted) {
    if (addedNodes.has(node.designerId)) continue;
    addedNodes.add(node.designerId);
    res.push(node);
    addNodeNeighboors(node.neightboors, res, addedNodes);
  }

  return res;
}

export class GraphLayout {
  nodes: { [designerId: string]: LayoutNode } = {};
  edges: LayoutEdge[] = [];

  constructor(public graph: GraphDefinition) {}

  static createCircle(graph: GraphDefinition): GraphLayout {
    const res = new GraphLayout(graph);
    if (_.isEmpty(graph.nodes)) return res;

    const addedNodes = new Set<string>();
    const circleSortedNodes: GraphNode[] = [];

    addNodeNeighboors(_.values(graph.nodes), circleSortedNodes, addedNodes);
    const nodeRadius = _.max(circleSortedNodes.map(x => x.radius));
    const nodeCount = circleSortedNodes.length;
    const radius = (nodeCount * nodeRadius) / (2 * Math.PI) + nodeRadius;

    let angle = 0;
    const dangle = (2 * Math.PI) / circleSortedNodes.length;
    for (const node of circleSortedNodes) {
      res.nodes[node.designerId] = new LayoutNode(node, Math.sin(angle) * radius, Math.cos(angle) * radius);
      angle += dangle;
    }
    res.fillEdges();

    return res;
  }

  fillEdges() {
    this.edges = this.graph.edges.map(edge => {
      const res = new LayoutEdge();
      res.edge = edge;
      const n1 = this.nodes[edge.source.designerId];
      const n2 = this.nodes[edge.target.designerId];
      res.length = n1.distanceTo(n2);
      res.source = n1;
      res.target = n2;
      return res;
    });
  }

  changePositions(nodeFunc: (node: LayoutNode) => LayoutNode): GraphLayout {
    const res = new GraphLayout(this.graph);
    res.nodes = _.mapValues(this.nodes, nodeFunc);
    res.fillEdges();
    return res;
  }

  fixViewBox() {
    const minX = _.min(_.values(this.nodes).map(n => n.left));
    const minY = _.min(_.values(this.nodes).map(n => n.top));

    return this.changePositions(n => n.translate(-minX + 50, -minY + 50));
  }

  springyStep() {
    const step = new ForceAlgorithmStep(this);
    step.applyHooksLaw();
    step.applyCoulombsLaw();
    step.applyGravity();
    return this.changePositions(node => step.moveNode(node));
  }

  springyAlg() {
    let res: GraphLayout = this;
    for (let step = 0; step < SPRINGY_STEPS; step++) {
      res = res.springyStep();
    }
    return res;
  }

  score() {
    let res = 0;
    for (const n1 of _.values(this.nodes)) {
      for (const n2 of _.values(this.nodes)) {
        if (n1.node.designerId == n2.node.designerId) {
          continue;
        }

        res += n1.intersectArea(n2);
      }
    }

    const minX = _.min(_.values(this.nodes).map(n => n.left));
    const minY = _.min(_.values(this.nodes).map(n => n.top));
    const maxX = _.max(_.values(this.nodes).map(n => n.right));
    const maxY = _.max(_.values(this.nodes).map(n => n.bottom));

    res += maxX - minX;
    res += maxY - minY;

    return res;
  }

  tryMoveNode(node: LayoutNode): GraphLayout[] {
    return [
      this.changePositions(x => (x == node ? node.translate(MOVE_STEP, 0) : x)),
      this.changePositions(x => (x == node ? node.translate(-MOVE_STEP, 0) : x)),
      this.changePositions(x => (x == node ? node.translate(0, MOVE_STEP) : x)),
      this.changePositions(x => (x == node ? node.translate(0, -MOVE_STEP) : x)),

      this.changePositions(x => (x == node ? node.translate(MOVE_BIG_STEP, MOVE_BIG_STEP) : x)),
      this.changePositions(x => (x == node ? node.translate(MOVE_BIG_STEP, -MOVE_BIG_STEP) : x)),
      this.changePositions(x => (x == node ? node.translate(-MOVE_BIG_STEP, MOVE_BIG_STEP) : x)),
      this.changePositions(x => (x == node ? node.translate(-MOVE_BIG_STEP, -MOVE_BIG_STEP) : x)),
    ];
  }

  tryMoveElement() {
    let res = null;
    let resScore = null;

    for (const node of _.values(this.nodes)) {
      for (const item of this.tryMoveNode(node)) {
        const score = item.score();
        if (resScore == null || score < resScore) {
          res = item;
          resScore = score;
        }
      }
    }

    return res;
  }

  doMoveSteps() {
    let res: GraphLayout = this;
    let score = res.score();
    for (let step = 0; step < MOVE_STEP_COUNT; step++) {
      const lastRes = res;
      res = res.tryMoveElement();
      const newScore = res.score();
      // console.log('SCORE, NEW SCORE', score, newScore);
      if (score - newScore < MINIMAL_SCORE_BENEFIT) return lastRes;
      score = newScore;
    }
    return res;
  }
}