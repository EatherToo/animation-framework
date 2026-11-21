/**
 * 2D 轮廓：肢体在屏幕平面里的中线 + 宽度曲线。
 * 顶点只有 (x, y)，深度单独给排序用。
 */
export {
  ARM_SECTIONS,
  armOutlineTriangles,
  armOutlineVertexCount,
  buildArmOutline,
  halfWidthAt,
  isArmPart,
  widthProfile,
} from './arm'
export type { ArmOutlineBones, ArmOutlineInput, OutlineMesh, Point2, Point3, WidthProfile } from './arm'
