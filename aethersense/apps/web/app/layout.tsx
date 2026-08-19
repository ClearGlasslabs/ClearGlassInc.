import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'AetherSense',description:'Local-first Wi-Fi CSI sensing research console'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
