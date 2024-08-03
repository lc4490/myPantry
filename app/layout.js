import { Inter } from "next/font/google";
import "./globals.css";
import { firebaseConfig } from "@/firebase";


const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "myPantry",
  description: "Pantry Tracker App powered by NextJS and Firebase",
};

export default function RootLayout({ children }) {
  return (

      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>

  );
}
