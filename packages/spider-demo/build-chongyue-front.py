"""Build a transparent, segmented front rig from the MiniMax reference edit.
Uses the current 24-bone hierarchy; no Spine runtime or source animations.
Run with the workspace's bundled Python (Pillow and numpy).
"""
from pathlib import Path
import json
import math
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BASE = Path(__file__).resolve().parent
OUT = BASE / 'assets/chongyue/front'
OUT.mkdir(exist_ok=True)
PARTS = OUT / 'parts'
PARTS.mkdir(exist_ok=True)
image = Image.open(OUT / 'generated-reference.jpg').convert('RGB')
width, height = image.size
assert (width, height) == (1664, 2496), 'Landmarks require the reviewed reference dimensions'
rgb = np.array(image)
# Remove only the connected white backdrop. Keep white clothing inside outlines.
white = rgb.min(axis=2) > 200
background = Image.fromarray(np.where(white, 0, 255).astype('uint8')).copy()
ImageDraw.floodfill(background, (0, 0), 128)
foreground = Image.fromarray(np.where(np.array(background) == 128, 0, 255).astype('uint8')).copy()
# Discard isolated JPEG/background flecks, retaining the connected character.
ImageDraw.floodfill(foreground, (832, 700), 128)
alpha = np.where(np.array(foreground) == 128, 255, 0).astype('uint8')
# Decontaminate the one-pixel JPEG matte instead of retaining pale block halos.
inner = np.array(Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)))
edge = (alpha > 0) & (inner == 0)
coverage = np.clip((255 - rgb.min(axis=2).astype(float)) / 160, 0, 1)
alpha[edge] = np.round(coverage[edge] * 255).astype('uint8')
clean_rgb = rgb.copy()
a = np.maximum(coverage[edge, None], 1 / 255)
clean_rgb[edge] = np.clip((rgb[edge].astype(float) - 255 * (1-a)) / a, 0, 255).astype('uint8')
rgba = np.dstack((clean_rgb, alpha))
rgba[alpha == 0, :3] = 0
transparent = Image.fromarray(rgba)
assert transparent.getbbox()[0] > 400 and transparent.getbbox()[2] < 1250, transparent.getbbox()
assert alpha[0].sum() == alpha[-1].sum() == 0


# Landmark coordinates in the generated image. L/R are the character's own.
points = {
    'root': (832, 2440), 'CY_Waist': (832, 1110),
    'CY_R_Leg': (723, 1160), 'CY_R_Calf': (680, 1745), 'CY_R_Foot': (641, 2300),
    'CY_L_Leg': (945, 1160), 'CY_L_Calf': (995, 1745), 'CY_L_Foot': (1040, 2300),
    'CY_Shirt': (832, 943), 'CY_Chest': (832, 625), 'CY_Neck': (832, 510), 'CY_Face': (832, 348),
    'CY_Hair_R_C': (770, 245), 'CY_Hair_L_C': (895, 245), 'CY_Hair_Back_B': (832, 225),
    'CY_L_Clavicle2': (910, 535), 'CY_L_Arm': (990, 555),
    'CY_L_Forearm': (1102, 881), 'CY_L_Hand': (1133, 1215),
    'CY_R_Clavicle': (755, 535), 'CY_R_Arm': (680, 555), 'CY_R_Arm3': (591, 767),
    'CY_R_Forearm': (555, 881), 'CY_R_Hand_B': (539, 1215),
}
ends = {
    'root': (832, 2440), 'CY_Waist': points['CY_Shirt'],
    'CY_R_Leg': points['CY_R_Calf'], 'CY_R_Calf': points['CY_R_Foot'], 'CY_R_Foot': (548, 2405),
    'CY_L_Leg': points['CY_L_Calf'], 'CY_L_Calf': points['CY_L_Foot'], 'CY_L_Foot': (1125, 2405),
    'CY_Shirt': points['CY_Chest'], 'CY_Chest': points['CY_Neck'], 'CY_Neck': points['CY_Face'],
    'CY_Face': (832, 250), 'CY_Hair_R_C': (725, 375), 'CY_Hair_L_C': (942, 375), 'CY_Hair_Back_B': (832, 160),
    'CY_L_Clavicle2': points['CY_L_Arm'], 'CY_L_Arm': points['CY_L_Forearm'],
    'CY_L_Forearm': points['CY_L_Hand'], 'CY_L_Hand': (1120, 1385),
    'CY_R_Clavicle': points['CY_R_Arm'], 'CY_R_Arm': points['CY_R_Arm3'],
    'CY_R_Arm3': points['CY_R_Forearm'], 'CY_R_Forearm': points['CY_R_Hand_B'], 'CY_R_Hand_B': (550, 1385),
}
SCALE = .5
def world(x, y): return ((x - 832) * SCALE, (2440 - y) * SCALE)
def multiply(a, b):
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
def inverse(m):
    a,b,c,d,x,y=m; det=a*d-b*c
    return [d/det,-b/det,-c/det,a/det,(c*y-d*x)/det,(b*x-a*y)/det]
def transform(m, x, y): return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]
hierarchy = json.loads((OUT / 'rig-hierarchy.json').read_text())
bones, matrices = [], []
for bone_id, (name, parent) in enumerate(hierarchy):
    assert -1 <= parent < bone_id, f'Invalid parent for {name}'
    x,y = world(*points[name]); ex,ey = world(*ends[name]); length = math.hypot(ex-x,ey-y)
    angle = math.atan2(ey-y,ex-x) if length else 0
    matrix = [math.cos(angle),math.sin(angle),-math.sin(angle),math.cos(angle),x,y]
    local = multiply(inverse(matrices[parent]),matrix) if parent >= 0 else matrix
    bones.append({'id':bone_id,'name':name,'parent':parent,'length':length,'local':local})
    matrices.append(matrix)
by_name = {b['name']:b['id'] for b in bones}

# Separate limb meshes with shared shoulder roots keep the torso centre stable.
# Connected coverage and a common weight field preserve the shoulder silhouette.
y,x = np.mgrid[:height,:width]
right_boundary = np.interp(y[:,0], [500,600,680,740,900,1450], [700,676,662,665,642,610])[:,None]
left_boundary = np.interp(y[:,0], [490,620,760,900,1450], [985,1000,1010,1027,1062])[:,None]
def connected_component(mask, seed):
    component = Image.fromarray(np.where(mask & (alpha > 0),255,0).astype('uint8')).copy()
    assert component.getpixel(seed) == 255, ('invalid component seed', seed)
    ImageDraw.floodfill(component, seed, 128)
    return np.array(component) == 128

# A geometric half-plane may also contain a disconnected sliver of trousers.
# Keep only the actual arm component, then assign every remaining pixel to body.
arm_r = connected_component((y >= 510) & (y < 1460) & (x < right_boundary), (550,900))
arm_l = connected_component((y >= 490) & (y < 1460) & (x > left_boundary), (1100,900))
head = y < 477
body = ~head & ~arm_r & ~arm_l
regions = [
    ('CY_Front_R_Leg', body & (y >= 1120) & (x < 834), 'legR'),
    ('CY_Front_L_Leg', body & (y >= 1120) & (x >= 834), 'legL'),
    ('CY_Front_Torso', body & (y < 1120), 'torso'),
    ('CY_Front_Head', head, 'head'),
    ('CY_Front_R_Arm', arm_r, 'armR'),
    ('CY_Front_L_Arm', arm_l, 'armL'),
]

def smooth(t):
    t=max(0,min(1,t)); return t*t*(3-2*t)
def mix(a,b,t):
    t=smooth(t); return {a:1-t,b:t}
def chain_y(py, names, bands):
    for i,(lo,hi) in enumerate(bands):
        if py < lo: return {names[i]:1}
        if py <= hi: return mix(names[i],names[i+1],(py-lo)/(hi-lo))
    return {names[-1]:1}
def cervical_weights(px,py):
    # One field for BOTH textures: jaw follows Face, lower neck blends into
    # Chest, and the shoulder/collar tips remain anchored to Chest.
    face = 1-smooth((py-390)/60)
    lateral = 1-smooth((abs(px-832)-70)/50)*smooth((py-440)/20)
    neck = (1-smooth((py-450)/70))*lateral
    return {'CY_Face':face,'CY_Neck':(1-face)*neck,'CY_Chest':(1-face)*(1-neck)}

def torso_weights(px,py):
    if py < 565: return cervical_weights(px,py)
    return chain_y(py,['CY_Chest','CY_Shirt','CY_Waist'],[(680,900),(925,1000)])

def arm_weights(left,py):
    prefix='CY_L_' if left else 'CY_R_'
    return chain_y(py, [prefix+'Arm',prefix+'Forearm',prefix+'Hand'] if left else [prefix+'Arm',prefix+'Arm3',prefix+'Forearm',prefix+'Hand_B'],
                   [(800,950),(1160,1240)] if left else [(710,790),(825,955),(1160,1240)])

def pectoral_weights(px,py):
    base=torso_weights(px,py)
    amount=.07*smooth((abs(px-832)-100)/55)*smooth((py-490)/60)*(1-smooth((py-590)/100))
    result={name:weight*(1-amount) for name,weight in base.items()}
    name='CY_L_Arm' if px>832 else 'CY_R_Arm'
    result[name]=amount
    return result

def shoulder_weights(left,px,py):
    # The proximal corner stays on the chest. Beyond the deltoid the
    # whole arm rotates rigidly; completed skin is hidden behind the shirt.
    limb=smooth((py-505)/105)
    base=torso_weights(px,py)
    result={name:weight*(1-limb) for name,weight in base.items()}
    for name,weight in arm_weights(left,py).items(): result[name]=result.get(name,0)+weight*limb
    return result

def weights_for(kind,px,py):
    if kind == 'head':
        if py > 390: return cervical_weights(px,py)
        hair = (1-smooth((py-300)/115))*.7
        group = 'CY_Hair_R_C' if px < 800 else 'CY_Hair_L_C' if px > 866 else 'CY_Hair_Back_B'
        return {'CY_Face':1-hair,group:hair}
    if kind == 'torso': return pectoral_weights(px,py)
    if kind.startswith('arm'): return shoulder_weights(kind=='armL',px,py)
    prefix = 'CY_L_' if kind=='legL' else 'CY_R_'
    if py < 1450:
        # Both sides use the same waist/hip field at the crotch seam.
        cross = 1-smooth((py-1290)/140)
        side = smooth((px-784)/100)
        left = cross*side + (1-cross)*(kind=='legL')
        limb = smooth((py-1140)/240) * (1-(1-smooth(abs(px-834)/100))*cross)
        return {'CY_Waist':1-limb,'CY_R_Leg':limb*(1-left),'CY_L_Leg':limb*left}
    return chain_y(py,[prefix+'Leg',prefix+'Calf',prefix+'Foot'],[(1650,1840),(2250,2350)])

textures,attachments,slots = [],[],[]

def make_attachment(part_id,name,kind,texture,cropped):
    rect=texture['sourceRect'];x0,y0=rect['x'],rect['y'];h,w=cropped.shape[:2]
    x1,y1=x0+w,y0+h
    xs=list(range(0,w-1,20))+[w-1];ys=list(range(0,h-1,20))+[h-1]
    if kind in ('head','torso','armL','armR'):
        xs=sorted({0,w-1,*[gx-x0 for gx in range(0,width,20) if x0<gx<x1-1]})
        rows=set(range(0,height,20)) | {390,430,450,460,477,490,494,500,510,520,600,620,680,740,760,780,900,1450,1460}
        # Extra joint rows/columns are identical in the body and arm meshes.
        rows.update(range(500,801,10))
        xs=sorted(set(xs)|{gx-x0 for gx in range(520,1161,10) if x0<gx<x1-1})
        ys=sorted({0,h-1,*[gy-y0 for gy in rows if y0<gy<y1-1]})
    vertices=[];lookup={};triangles=[]
    def vertex(p):
        key=tuple(round(v,6) for v in p)
        if key not in lookup: lookup[key]=len(vertices);vertices.append(key)
        return lookup[key]
    for iy in range(len(ys)-1):
        for ix in range(len(xs)-1):
            if not cropped[ys[iy]:ys[iy+1]+1,xs[ix]:xs[ix+1]+1,3].any():continue
            a=(xs[ix],ys[iy]);b=(xs[ix+1],ys[iy]);c=(xs[ix],ys[iy+1]);d=(xs[ix+1],ys[iy+1])
            for poly in ([a,c,b],[b,c,d]):
                for j in range(1,len(poly)-1):
                    v=[poly[0],poly[j],poly[j+1]]
                    area=(v[1][0]-v[0][0])*(v[2][1]-v[0][1])-(v[1][1]-v[0][1])*(v[2][0]-v[0][0])
                    if abs(area)>1e-7: triangles.extend(vertex(p) for p in v)
    positions,uvs,bi,ws,ip,si=[],[],[],[],[],[]
    for px,py in vertices:
        gx,gy=px+x0,py+y0;wx,wy=world(gx,gy)
        positions.extend([wx,wy]);uvs.extend([px/w,py/h])
        weights=weights_for(kind,gx,gy)
        influences=[(by_name[n],v) for n,v in weights.items() if v>0]
        assert len(influences)<=4, (name,gx,gy,influences)
        assert abs(sum(v for _,v in influences)-1)<1e-9
        if kind=='torso':
            arm_mass=sum(v for n,v in weights.items() if n.startswith(('CY_L_','CY_R_')))
            if abs(gx-832)<=100: assert arm_mass==0, 'centre chest and abdomen must stay independent of shoulders'
        for i in range(4):
            bid,weight=influences[i] if i<len(influences) else (0,0)
            bi.append(bid);ws.append(weight);ip.extend(transform(inverse(matrices[bid]),wx,wy) if weight else [0,0]);si.append(-1)
    attachment={'id':part_id,'name':name,'kind':'mesh','slot':part_id,'bone':by_name['CY_Waist'],
        'positions':positions,'uvs':uvs,'indices':triangles,'textureId':texture['id'],'page':texture['id'],'materialId':texture['id'],
        'weights':ws,'boneIndices':bi,'influencesPerVertex':4,'influencePositions':ip,'influenceSourceIndices':si}
    attachments.append(attachment)
    slots.append({'id':part_id,'name':name,'bone':by_name['CY_Waist'],'blend':'normal','color':[1,1,1,1]})

shoulder_rgb=np.array(Image.open(OUT/'shoulder-source.jpg').convert('RGB'))
assert shoulder_rgb.shape==rgb.shape

for part_id,(name,mask,kind) in enumerate(regions):
    # Grow coverage along connected skin only. A rectangular dilation can jump
    # an air gap and copy trouser edges into the wrists or the opposite leg.
    expanded = mask & (alpha > 0)
    if not kind.startswith('arm'):
        for _ in range(17):
            expanded = (np.array(Image.fromarray(expanded.astype('uint8')*255).filter(ImageFilter.MaxFilter(3))) > 0) & (alpha > 0)
    artwork=rgba
    if kind == 'torso': expanded &= ~(arm_r | arm_l)
    if kind.startswith('arm'):
        # Complete the occluded medial deltoid with generated skin, instead of
        # stretching shirt pixels or placing a rectangular connector in the gap.
        expanded=mask & (alpha>0)
        boundary=left_boundary if kind=='armL' else right_boundary
        outward=x-boundary if kind=='armL' else boundary-x
        radius=40*np.sqrt(np.maximum(0,1-((y-575)/80)**2))
        cap=(y>=505)&(y<655)&(outward>=-radius)&(alpha>0)
        added=cap & ~expanded
        expanded |= cap
        artwork=rgba.copy()
        left=kind=='armL'
        # Only newly exposed, previously occluded skin uses the repair sheet.
        # Keep all visible original tattoo and armor pixels untouched.
        sx,sy=(980,625) if left else (650,580)
        tx,ty=(1028,700) if left else (645,570)
        correction=rgb[ty,tx].astype(float)-shoulder_rgb[sy,sx].astype(float)
        for row in range(505,655):
            columns=np.flatnonzero(added[row])
            if not len(columns): continue
            sample_y=int(sy+(row-600)*.15)
            sample_x=np.clip(np.rint(sx+outward[row,columns]*.12),sx-6,sx+6).astype(int)
            patch=np.clip(shoulder_rgb[sample_y,sample_x].astype(float)+correction,0,255)
            artwork[row,columns,:3]=np.rint(patch).astype('uint8')
    pa = np.where(expanded,alpha,0).astype('uint8')
    if kind == 'armR': assert not pa[1370,625], 'right wrist must not contain trouser fragments'
    if kind == 'armL': assert not pa[1370,1040], 'left wrist must not contain trouser fragments'
    if kind == 'torso':
        assert not np.any(pa[800:1050][(arm_r|arm_l)[800:1050]]), 'no detached upper-arm strips below the shared root'
    box = Image.fromarray(pa).getbbox(); assert box, name
    x0,y0,x1,y1=box; x0=max(0,x0-3);y0=max(0,y0-3);x1=min(width,x1+3);y1=min(height,y1+3)
    cropped=artwork[y0:y1,x0:x1].copy(); cropped[:,:,3]=pa[y0:y1,x0:x1];cropped[cropped[:,:,3]==0,:3]=0
    h,w=cropped.shape[:2];Image.fromarray(cropped).save(PARTS / (name+'.png'))
    textures.append({'id':part_id,'name':name,'url':'parts/'+name+'.png','width':w,'height':h,'padding':3,'premultipliedAlpha':False,'sourceRect':{'x':x0,'y':y0,'width':w,'height':h}})
    make_attachment(part_id,name,kind,textures[-1],cropped)
values=[v for m in matrices for v in m];slot_offset=len(values)
draw_order=[0,1,4,5,2,3]
for i in range(len(slots)): values.extend([i,draw_order[i],1,1,1,1])
all_positions=np.array([a['positions'][i:i+2] for a in attachments for i in range(0,len(a['positions']),2)])
lo,hi=all_positions.min(axis=0),all_positions.max(axis=0)
pose={'name':'front-natural-stance','url':'character-pose.bin','matrixOffset':0,'matrixFloatCount':len(matrices)*6,'matrixStride':6,
      'slotOffset':slot_offset,'slotStride':6,'deformOffset':len(values),'deforms':[],'floatCount':len(values),
      'bounds':{'x':float((lo[0]+hi[0])/2),'y':float((lo[1]+hi[1])/2),'width':float(hi[0]-lo[0]),'height':float(hi[1]-lo[1])}}
metadata={'format':'render-engine-native-static','version':2,'skeletonUrl':'skeleton.json','textures':textures,'attachments':attachments,'pose':pose,
          'source':{'rigHierarchy':'rig-hierarchy.json','generator':'MiniMax-H3-Image reference edit','requestId':'0755b97296cfd61b46ad067c9a942362',
                    'shoulderMaterial':{'image':'shoulder-source.jpg','requestId':'0755f71261ab7e70cf44f91c3a6f6b6e','sha256':hashlib.sha256((OUT/'shoulder-source.jpg').read_bytes()).hexdigest()},
                     'generatedImage':'generated-reference.jpg','generatedSHA256':hashlib.sha256((OUT/'generated-reference.jpg').read_bytes()).hexdigest(),
                    'attribution':'Chongyue / Arknights — original character by Hypergryph / Yostar; front artwork generated using the current character as reference',
                    'notes':'Generated front view; existing 24-bone hierarchy, manually adjusted joint landmarks, isolated limb meshes, coincident bind points, smooth joint weights.'}}
for filename,data in [('skeleton.json',{'format':'render-engine-skeleton2d','version':1,'bones':bones,'slots':slots}),('character-native.json',metadata)]:
    (OUT/filename).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
(OUT/'character-pose.bin').write_bytes(struct.pack('<'+'f'*len(values),*values))
print(json.dumps({'bones':len(bones),'parts':len(textures),'vertices':sum(len(a['positions'])//2 for a in attachments),'foregroundBounds':transparent.getbbox(),'transparentPixels':int((alpha==0).sum())}))
