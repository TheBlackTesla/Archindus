export type Point={x:number;y:number;z:number;size:number};
/** Same six nearest neighbors; reuse six slots instead of sorting N objects per point. */
export function nearestGraph(points:Point[]) {
  const edges:[number,number][]=[],neighbors:number[][]=points.map(()=>[]);
  const ds=new Float64Array(6),ids=new Int32Array(6);
  for(let i=0;i<points.length;i++){ds.fill(Infinity);ids.fill(-1);const p=points[i];
    for(let j=0;j<points.length;j++){if(i===j)continue;const q=points[j],x=p.x-q.x,y=p.y-q.y,z=p.z-q.z,d=x*x+y*y+z*z;if(d>=ds[5])continue;
      let k=5;while(k>0&&d<ds[k-1]){ds[k]=ds[k-1];ids[k]=ids[k-1];k--;}ds[k]=d;ids[k]=j;}
    for(const j of ids)if(j>i){edges.push([i,j]);neighbors[i].push(j);neighbors[j].push(i);}
  }return {edges,neighbors};
}
