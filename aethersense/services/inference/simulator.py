import math, random
class Simulator:
    def __init__(self,seed=7,fs=20,n=52): self.r=random.Random(seed); self.t=0.0; self.fs=fs; self.n=n; self.scenario='breathing'
    def next(self):
        t=self.t; self.t+=1/self.fs; amp=[]; phase=[]
        breath=15/60; heart=72/60
        for k in range(self.n):
            base=1+0.05*math.sin(k*.22)+0.04*math.sin(t*1.7+k*.04)
            micro=.035*math.sin(2*math.pi*breath*t+k*.02)+.012*math.sin(2*math.pi*heart*t)
            motion=.08*math.sin(2*math.pi*.32*t) if int(t)%18<7 else .01*math.sin(t)
            amp.append(max(.01,base+micro+motion+(self.r.random()-.5)*.035))
            phase.append(math.atan2(math.sin(k*.08+micro*5+motion*2),math.cos(k*.08+micro*5+motion*2))+(self.r.random()-.5)*.03)
        return {'timestamp':t,'source':'simulator','nodeId':'sim-01','rssi':-47,'channel':36,'subcarriers':list(range(-26,26)),'amplitudes':amp,'phases':phase}
